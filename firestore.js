// =================================================================================
// ARQUIVO: firestore.js
// VERSÃO: 2.1 (Com Paginação e Busca Server-Side)

import {
    doc, addDoc, setDoc, deleteDoc, collection, getDoc, updateDoc, arrayUnion,
    query, where, getDocs, limit, startAfter, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from './firebase.js';
import { state } from './state.js';

// --- FUNÇÕES DE REFERÊNCIA (Caminhos para os dados) ---

/**
 * Retorna a referência para a COLEÇÃO de alunos.
 * @returns {CollectionReference}
 */
export const getStudentsCollectionRef = () => {
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    return collection(db, `/artifacts/${appId}/public/data/students`);
};

/**
 * Retorna a referência para o documento de configurações da escola.
 * @returns {DocumentReference}
 */
export const getSchoolConfigDocRef = () => {
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    return doc(db, `/artifacts/${appId}/public/data/school-data`, 'config');
};

/**
 * Retorna a referência para uma coleção principal ('occurrences' ou 'absences').
 * @param {string} type - O nome da coleção.
 * @returns {CollectionReference}
 */
export const getCollectionRef = (type) => {
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    const collectionName = type === 'occurrence' ? 'occurrences' : 'absences';
    return collection(db, `/artifacts/${appId}/public/data/${collectionName}`);
};

/**
 * Retorna a referência para um documento de contador.
 * @param {string} counterName - O nome do contador (ex: 'occurrences').
 * @returns {DocumentReference}
 */
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

/**
 * (OTIMIZADO) Carrega alunos de forma paginada.
 * @param {object|null} lastVisibleDoc - O último documento carregado (cursor) ou null para o início.
 * @param {number} pageSize - Quantidade de registos por página (Padrão: 50).
 * @returns {Promise<object>} - { students: Array, lastVisible: DocSnapshot }
 */
export const loadStudentsPaginated = async (lastVisibleDoc = null, pageSize = 50) => {
    try {
        const studentsRef = getStudentsCollectionRef();
        
        // Consulta base ordenada por nome
        let q = query(studentsRef, orderBy('name'), limit(pageSize));

        // Se tiver cursor, começa depois dele
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
 * (NOVO) Busca alunos pelo nome no servidor (Firestore).
 * Essencial quando se tem milhares de alunos e não se pode filtrar no cliente.
 * Nota: O Firestore é case-sensitive por padrão. Para busca perfeita, precisaríamos de um campo 'name_lowercase'.
 * Aqui usamos uma busca de prefixo simples.
 */
export const searchStudentsByName = async (searchText) => {
    if (!searchText) return [];
    
    // Normaliza para evitar buscas vazias
    const term = searchText.trim();
    // O caractere \uf8ff é um truque do Firestore para simular "começa com"
    const endTerm = term + '\uf8ff';

    try {
        const studentsRef = getStudentsCollectionRef();
        const q = query(
            studentsRef, 
            orderBy('name'), 
            where('name', '>=', term),
            where('name', '<=', endTerm),
            limit(20) // Limita resultados da busca para não travar
        );

        const querySnapshot = await getDocs(q);
        const results = [];
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            if (!data.matricula) data.matricula = doc.id;
            results.push(data);
        });
        return results;

    } catch (error) {
        console.error("Erro na busca de alunos:", error);
        return [];
    }
};

/**
 * (LEGADO/COMPATIBILIDADE) Função antiga adaptada.
 * Agora carrega apenas a PRIMEIRA página para popular o estado inicial,
 * evitando o crash de "Download da Morte".
 */
export const loadStudents = async () => {
    try {
        // Carrega apenas os primeiros 50 para a interface inicial
        const { students, lastVisible } = await loadStudentsPaginated(null, 50);
        
        state.students = students;
        
        // Salva o cursor no estado (precisaremos adicionar isso ao state.js depois)
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

/**
 * (NOVO) Busca um aluno específico pelo ID.
 * Útil quando uma ocorrência cita um aluno que não está na lista paginada atual.
 */
export const getStudentById = async (studentId) => {
    // Primeiro verifica se já está na memória
    const cachedStudent = state.students.find(s => s.matricula === studentId);
    if (cachedStudent) return cachedStudent;

    try {
        const docRef = doc(getStudentsCollectionRef(), studentId);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
            const data = docSnap.data();
            if (!data.matricula) data.matricula = docSnap.id;
            // Opcional: Adicionar ao state.students para cache futuro? 
            // Não por enquanto, para não poluir a lista visual da tabela.
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

        // Otimização: Busca paralela de alunos faltantes
        const studentPromises = participantsList.map(async (participant) => {
            // Tenta buscar na memória ou no banco individualmente
            const student = await getStudentById(participant.studentId);
            if (student) {
                return {
                    id: participant.studentId,
                    data: {
                        student: student,
                        role: participant.role || 'Envolvido'
                    }
                };
            }
            return null;
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