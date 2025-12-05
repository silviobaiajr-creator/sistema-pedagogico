
// =================================================================================
// ARQUIVO: firestore.js
// VERSÃO: 3.4 (Correção: Solução Inteligente para Duplicatas no Arquivo Digital)

import {
    doc, addDoc, setDoc, deleteDoc, collection, getDoc, updateDoc, arrayUnion,
    query, where, getDocs, limit, startAfter, orderBy, getCountFromServer
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
    // Mapeamento correto para documentos legais
    if (type === 'documents') return collection(db, `/artifacts/${appId}/public/data/legal_documents`);
    
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

const toTitleCase = (str) => {
    return str.replace(/\w\S*/g, (txt) => {
        return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
    });
}

export const searchStudentsByName = async (searchText) => {
    if (!searchText) return [];
    
    const rawTerm = searchText.trim();
    if (!rawTerm) return [];

    const variations = new Set();
    variations.add(rawTerm);
    variations.add(rawTerm.toLowerCase());
    variations.add(rawTerm.toUpperCase());
    variations.add(toTitleCase(rawTerm));

    const studentsRef = getStudentsCollectionRef();
    const promises = [];

    variations.forEach(term => {
        const endTerm = term + '\uf8ff';
        const q = query(
            studentsRef, 
            orderBy('name'), 
            where('name', '>=', term),
            where('name', '<=', endTerm),
            limit(10)
        );
        promises.push(getDocs(q));
    });

    try {
        const snapshots = await Promise.all(promises);
        const resultsMap = new Map();

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

// --- CONFIGURAÇÕES E INCIDENTES ---

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

        const studentPromises = participantsList.map(async (participant) => {
            let student = null;
            try {
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

            if (!student) {
                student = {
                    matricula: participant.studentId,
                    name: participant.studentName || `Aluno (${participant.studentId})`,
                    class: participant.studentClass || 'N/A',
                    isPlaceholder: true
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

// --- RELATÓRIOS E DASHBOARD ---

export const getOccurrencesForReport = async (startDate, endDate, type) => {
    try {
        let q = getCollectionRef('occurrence');
        const conditions = [];

        if (startDate) conditions.push(where('date', '>=', startDate));
        if (endDate) conditions.push(where('date', '<=', endDate));
        if (type && type !== 'all') conditions.push(where('occurrenceType', '==', type));

        if (conditions.length > 0) {
            q = query(q, ...conditions);
        } else {
            q = query(q, orderBy('date', 'desc'), limit(500));
        }

        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    } catch (error) {
        console.error("Erro ao gerar relatório de ocorrências:", error);
        throw error;
    }
};

export const getAbsencesForReport = async (startDate, endDate) => {
    try {
        let q = getCollectionRef('absence');
        const conditions = [];

        if (startDate) {
            const start = new Date(startDate);
            conditions.push(where('createdAt', '>=', start));
        }
        if (endDate) {
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);
            conditions.push(where('createdAt', '<=', end));
        }

        if (conditions.length > 0) {
            q = query(q, ...conditions);
        } else {
            q = query(q, orderBy('createdAt', 'desc'), limit(500));
        }

        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    } catch (error) {
        console.error("Erro ao gerar relatório de busca ativa:", error);
        throw error;
    }
};

export const getDashboardStats = async () => {
    try {
        const studentColl = getStudentsCollectionRef();
        const occurrenceColl = getCollectionRef('occurrence');
        const absenceColl = getCollectionRef('absence');

        const snapStudents = await getCountFromServer(studentColl);
        const snapOccurrences = await getCountFromServer(occurrenceColl);
        const snapAbsencesTotal = await getCountFromServer(absenceColl);
        
        const qConcluded = query(absenceColl, where('actionType', '==', 'analise'));
        const snapAbsencesConcluded = await getCountFromServer(qConcluded);

        const recentOccurrences = await getDocs(query(occurrenceColl, orderBy('date', 'desc'), limit(50)));
        const recentAbsences = await getDocs(query(absenceColl, orderBy('createdAt', 'desc'), limit(50)));

        return {
            totalStudents: snapStudents.data().count,
            totalOccurrences: snapOccurrences.data().count,
            totalAbsences: snapAbsencesTotal.data().count, 
            concludedAbsences: snapAbsencesConcluded.data().count,
            chartDataOccurrences: recentOccurrences.docs.map(d => d.data()),
            chartDataAbsences: recentAbsences.docs.map(d => d.data())
        };

    } catch (error) {
        console.error("Erro ao buscar stats do dashboard:", error);
        return null;
    }
};

// --- ARQUIVO DIGITAL / SNAPSHOTS (NOVAS FUNÇÕES COM PREVENÇÃO DE DUPLICATAS) ---

export const saveDocumentSnapshot = async (docType, title, htmlContent, studentId, metadata = {}) => {
    try {
        const documentsRef = getCollectionRef('documents');
        // Garante que IDs sejam strings para consistência na busca e salvamento
        const refId = metadata.refId ? String(metadata.refId) : null;
        const safeStudentId = studentId ? String(studentId) : null;
        
        // CORREÇÃO: Verifica se já existe um documento com as mesmas características (Tipo, Aluno, RefID)
        if (refId && safeStudentId) {
            const q = query(
                documentsRef, 
                where('type', '==', docType),
                where('studentId', '==', safeStudentId),
                where('refId', '==', refId),
                limit(1)
            );
            
            const snapshot = await getDocs(q);
            
            if (!snapshot.empty) {
                const docToUpdate = snapshot.docs[0];
                const currentData = docToUpdate.data();

                // SOLUÇÃO INTELIGENTE: 
                // Compara o conteúdo HTML atual com o novo.
                // Se forem idênticos, NÃO faz nada (nem update). Evita duplicatas visuais e escritas no banco.
                if (currentData.htmlContent === htmlContent) {
                    console.log(`Documento [${docToUpdate.id}] é idêntico. Nenhuma alteração salva.`);
                    return docToUpdate.ref; 
                }

                // SE EXISTIR MAS FOR DIFERENTE: Atualiza o conteúdo e a data
                // Isso mantém apenas UMA cópia deste documento no arquivo, mas com os dados mais recentes.
                await updateDoc(doc(documentsRef, docToUpdate.id), {
                    title: title,
                    htmlContent: htmlContent,
                    createdAt: new Date(), // Atualiza data para subir na lista pois houve alteração real
                    createdBy: state.userEmail || 'Sistema'
                });
                console.log(`Documento atualizado: ${docToUpdate.id}`);
                return docToUpdate.ref;
            }
        }

        // SE NÃO EXISTIR: Cria um novo registro
        const docData = {
            type: docType, // 'ata', 'oficio', 'notificacao', 'relatorio', 'ficha_busca_ativa'
            title: title,
            htmlContent: htmlContent, 
            studentId: safeStudentId || null,
            studentName: metadata.studentName || null,
            refId: refId, // ID único da Ocorrência, Processo ou Tentativa
            createdAt: new Date(),
            createdBy: state.userEmail || 'Sistema'
        };
        
        return addDoc(documentsRef, docData);

    } catch (error) {
        console.error("Erro ao salvar snapshot do documento:", error);
    }
};

export const loadDocuments = async (filters = {}) => {
    try {
        let q = query(getCollectionRef('documents'), orderBy('createdAt', 'desc'), limit(50));
        
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
        console.error("Erro ao carregar documentos:", error);
        return [];
    }
};
