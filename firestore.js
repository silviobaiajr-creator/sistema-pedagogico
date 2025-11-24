// =================================================================================
// ARQUIVO: firestore.js
// VERSÃO: 2.4 (Correção: Robustez no carregamento de incidentes com timeout)

import {
    doc, addDoc, setDoc, deleteDoc, collection, getDoc, updateDoc, arrayUnion,
    query, where, getDocs, limit, startAfter, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from './firebase.js';
import { state } from './state.js';

// --- FUNÇÕES DE REFERÊNCIA ---

export const getStudentsCollectionRef = () => {
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    return collection(db, `/artifacts/${appId}/public/data/students`);
};

export const getSchoolConfigDocRef = () => {
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    return doc(db, `/artifacts/${appId}/public/data/school-data`, 'config');
};

export const getCollectionRef = (type) => {
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    const collectionName = type === 'occurrence' ? 'occurrences' : 'absences';
    return collection(db, `/artifacts/${appId}/public/data/${collectionName}`);
};

export const getCounterDocRef = (counterName) => {
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    return doc(db, `/artifacts/${appId}/public/data/counters`, counterName);
};


// --- FUNÇÕES CRUD COM HISTÓRICO ---

export const addRecordWithHistory = (type, data, historyAction, userEmail = 'sistema') => {
    const newHistoryEntry = {
        action: historyAction,
        user: userEmail,
        timestamp: new Date()
    };

    const finalData = { 
        ...data, 
        createdAt: new Date(),
        createdBy: userEmail,
        history: [newHistoryEntry]
    };
    
    return addDoc(getCollectionRef(type), finalData);
};

export const updateRecordWithHistory = (type, id, dataToUpdate, historyAction, userEmail = 'sistema') => {
    const recordRef = doc(getCollectionRef(type), id);
    
    const newHistoryEntry = {
        action: historyAction,
        user: userEmail,
        timestamp: new Date()
    };
    
    const finalUpdateData = {
        ...dataToUpdate,
        updatedAt: new Date(),
        updatedBy: userEmail,
        history: arrayUnion(newHistoryEntry)
    };

    return setDoc(recordRef, finalUpdateData, { merge: true });
};

export const deleteRecord = (type, id) => deleteDoc(doc(getCollectionRef(type), id));


// --- FUNÇÕES DE LEITURA OTIMIZADAS (PAGINAÇÃO E BUSCA) ---

export const loadStudentsPaginated = async (lastVisibleDoc = null, pageSize = 50) => {
    try {
        const studentsRef = getStudentsCollectionRef();
        let q = query(studentsRef, orderBy('name'), limit(pageSize));

        if (lastVisibleDoc) {
            q = query(studentsRef, orderBy('name'), startAfter(lastVisibleDoc), limit(pageSize));
        }

        const querySnapshot = await getDocs(q);
        const studentsList = [];
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            if (!data.matricula) data.matricula = doc.id;
            studentsList.push(data);
        });

        const lastVisible = querySnapshot.docs[querySnapshot.docs.length - 1] || null;
        return { students: studentsList, lastVisible };

    } catch (error) {
        console.error("Erro na paginação de alunos:", error);
        throw error;
    }
};

/**
 * Auxiliar para converter texto para Title Case (Primeira Letra Maiúscula).
 * Ex: "joao da silva" -> "Joao Da Silva"
 */
const toTitleCase = (str) => {
    return str.replace(/\w\S*/g, (txt) => {
        return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
    });
}

/**
 * Busca Inteligente Multi-Caso.
 * Tenta encontrar o aluno buscando pelo termo exato, TitleCase e UpperCase simultaneamente.
 */
export const searchStudentsByName = async (searchText) => {
    if (!searchText) return [];
    
    const rawTerm = searchText.trim();
    if (!rawTerm) return [];

    // Cria variações do termo para tentar "adivinhar" como está no banco
    const variations = new Set();
    variations.add(rawTerm); // Como digitado
    variations.add(rawTerm.toLowerCase()); // Minúsculo
    variations.add(rawTerm.toUpperCase()); // Maiúsculo (comum em sistemas antigos)
    variations.add(toTitleCase(rawTerm)); // Title Case (Padrão de nomes: Ana Silva)

    const studentsRef = getStudentsCollectionRef();
    const promises = [];

    // Dispara uma busca para cada variação
    variations.forEach(term => {
        const endTerm = term + '\uf8ff'; // Truque do Firestore para "começa com"
        const q = query(
            studentsRef, 
            orderBy('name'), 
            where('name', '>=', term),
            where('name', '<=', endTerm),
            limit(10) // Limite menor por variação para não sobrecarregar
        );
        promises.push(getDocs(q));
    });

    try {
        const snapshots = await Promise.all(promises);
        const resultsMap = new Map(); // Map para remover duplicatas (mesmo aluno encontrado em variações diferentes)

        snapshots.forEach(snap => {
            snap.forEach(doc => {
                const data = doc.data();
                if (!data.matricula) data.matricula = doc.id;
                resultsMap.set(data.matricula, data);
            });
        });

        return Array.from(resultsMap.values());

    } catch (error) {
        console.error("Erro na busca inteligente de alunos:", error);
        return [];
    }
};

export const loadStudents = async () => {
    try {
        const { students, lastVisible } = await loadStudentsPaginated(null, 50);
        state.students = students;
        state.pagination = {
            lastVisible: lastVisible,
            hasMore: students.length === 50,
            isLoading: false
        };
        console.log(`Inicialização: ${students.length} alunos carregados.`);
    } catch (error) {
        console.error("Erro ao carregar lista inicial:", error);
        if (error.code === 'permission-denied') {
            throw new Error("Permissão negada. Atualize o firestore.rules.");
        }
        throw new Error("Erro ao carregar alunos.");
    }
};

export const getStudentById = async (studentId) => {
    const cachedStudent = state.students.find(s => s.matricula === studentId);
    if (cachedStudent) return cachedStudent;

    try {
        const docRef = doc(getStudentsCollectionRef(), studentId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            const data = docSnap.data();
            if (!data.matricula) data.matricula = docSnap.id;
            return data;
        }
        return null;
    } catch (error) {
        console.error(`Erro ao buscar aluno ${studentId}:`, error);
        return null;
    }
};

// --- CONFIGURAÇÕES E INCIDENTES (Inalterados) ---

export const loadSchoolConfig = async () => {
    try {
        const docSnap = await getDoc(getSchoolConfigDocRef());
        if (docSnap.exists()) {
            state.config = docSnap.data();
        } else {
            state.config = {
                schoolName: "EMEF. DILMA DOS SANTOS CARVALHO",
                city: "Cidade (Exemplo)",
                schoolLogoUrl: null
            };
        }
    } catch (error) {
        console.error("Erro ao carregar configurações:", error);
        throw new Error("Erro ao carregar as configurações.");
    }
};

export const saveSchoolConfig = (data) => {
    const configRef = getSchoolConfigDocRef();
    return setDoc(configRef, data, { merge: true });
};

export const getIncidentByGroupId = async (groupId) => {
    const incidentQuery = query(getCollectionRef('occurrence'), where('occurrenceGroupId', '==', groupId));
    
    try {
        const querySnapshot = await getDocs(incidentQuery);
        if (querySnapshot.empty) return null;

        const incident = {
            id: groupId,
            records: [],
            participantsInvolved: new Map(),
        };

        querySnapshot.forEach(doc => {
            incident.records.push({ id: doc.id, ...doc.data() });
        });

        if (incident.records.length === 0) return null;
        
        const mainRecord = incident.records[0];
        const participantsList = mainRecord.participants || [];

        // (CORREÇÃO) Busca robusta de alunos com Timeout
        const studentPromises = participantsList.map(async (participant) => {
            let student = null;
            try {
                // Tenta buscar o aluno com um timeout de 3 segundos
                // Se o banco travar ou o aluno não existir, não bloqueia o modal
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error("Timeout")), 3000)
                );
                
                student = await Promise.race([
                    getStudentById(participant.studentId),
                    timeoutPromise
                ]);
            } catch (e) {
                console.warn(`Aviso: Falha ao carregar aluno ${participant.studentId} no incidente:`, e);
            }

            // Se não encontrou ou deu erro, usa dados parciais (desnormalizados ou placeholder)
            if (!student) {
                student = {
                    matricula: participant.studentId,
                    name: participant.studentName || `Aluno (${participant.studentId})`, // Tenta usar nome salvo no registro
                    class: participant.studentClass || 'N/A',
                    isPlaceholder: true // Marca para saber que não é o dado completo
                };
            }

            return {
                id: participant.studentId,
                data: {
                    student: student,
                    role: participant.role || 'Envolvido'
                }
            };
        });

        const resolvedStudents = await Promise.all(studentPromises);
        resolvedStudents.forEach(item => {
            if (item) incident.participantsInvolved.set(item.id, item.data);
        });

        const allResolved = incident.records.every(r => r.statusIndividual === 'Resolvido');
        incident.overallStatus = allResolved ? 'Finalizada' : 'Pendente';

        return incident;

    } catch (error) {
        console.error(`Erro ao buscar incidente por GroupId (${groupId}):`, error);
        return null;
    }
};