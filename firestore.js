// =================================================================================
// ARQUIVO: firestore.js

import {
    doc, addDoc, setDoc, deleteDoc, collection, getDoc, updateDoc, arrayUnion,
    query, where, getDocs, limit, orderBy, startAt, endAt
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from './firebase.js';
import { state } from './state.js';

// --- FUNÇÕES DE REFERÊNCIA (Caminhos para os dados) ---

/**
 * (LEGADO) Retorna a referência para o documento antigo de lista.
 * Mantido apenas para referência, não usado na nova lógica de escrita.
 */
export const getLegacyStudentsDocRef = () => {
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    return doc(db, `/artifacts/${appId}/public/data/school-data`, 'students');
};

/**
 * (NOVO - ESCALÁVEL) Retorna a referência para a COLEÇÃO de alunos.
 * Agora cada aluno será um documento dentro desta pasta.
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
 * Usado para gerar IDs sequenciais.
 * @param {string} counterName - O nome do contador (ex: 'occurrences').
 * @returns {DocumentReference}
 */
export const getCounterDocRef = (counterName) => {
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    return doc(db, `/artifacts/${appId}/public/data/counters`, counterName);
};


// --- FUNÇÕES CRUD COM HISTÓRICO (Criar, Ler, Atualizar, Excluir) ---

/**
 * Adiciona um novo registo à base de dados com uma entrada inicial de histórico.
 * @param {string} type - O tipo de coleção ('occurrence' ou 'absence').
 * @param {object} data - Os dados do registo a serem salvos.
 * @param {string} historyAction - A descrição da ação para o histórico (ex: "Registro criado").
 * @param {string} userEmail - O email do utilizador que está a criar o registo.
 * @returns {Promise<DocumentReference>} A referência do documento criado.
 */
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
        history: [newHistoryEntry] // O histórico já começa com a criação
    };
    
    return addDoc(getCollectionRef(type), finalData);
};

/**
 * Atualiza um registo, adicionando uma nova entrada ao histórico.
 * @param {string} type - O tipo de coleção.
 * @param {string} id - O ID do documento.
 * @param {object} dataToUpdate - Os campos a serem atualizados.
 * @param {string} historyAction - A descrição da ação para o histórico (ex: "Status alterado para Concluído").
 * @param {string} userEmail - O email do utilizador que está a realizar a ação.
 * @returns {Promise<void>}
 */
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
        history: arrayUnion(newHistoryEntry) // Adiciona ao array sem sobrescrever
    };

    return setDoc(recordRef, finalUpdateData, { merge: true });
};


/**
 * Exclui um registo da base de dados.
 * ATENÇÃO: Esta é uma exclusão permanente (hard delete). A lógica de negócio
 * no `main.js` pode optar por usar `updateRecordWithHistory` para um "soft delete"
 * (marcando como excluído) em vez de chamar esta função diretamente.
 * @param {string} type - O tipo de coleção.
 * @param {string} id - O ID do documento a ser excluído.
 * @returns {Promise<void>}
 */
export const deleteRecord = (type, id) => deleteDoc(doc(getCollectionRef(type), id));


// --- FUNÇÕES DE CARREGAMENTO E SALVAMENTO DE DADOS ---

/**
 * (REESCRITO V3 - PAGINAÇÃO) Carrega a lista de alunos da COLEÇÃO com LIMITE.
 * Carrega apenas os primeiros 10 alunos (ordenados por nome) para evitar travar o navegador.
 * @returns {Promise<void>}
 */
export const loadStudents = async () => {
    try {
        const studentsRef = getStudentsCollectionRef();
        
        // --- PAGINAÇÃO: Limita a 10 alunos ---
        // Ordena por nome para garantir consistência visual
        const q = query(studentsRef, orderBy('name'), limit(10));
        
        const querySnapshot = await getDocs(q);
        
        const studentsList = [];
        querySnapshot.forEach((doc) => {
            const studentData = doc.data();
            if (!studentData.matricula) studentData.matricula = doc.id;
            studentsList.push(studentData);
        });

        state.students = studentsList;
        console.log(`${studentsList.length} alunos carregados (Limite aplicado: 10).`);
        
    } catch (error) {
        console.error("Erro ao carregar lista de alunos (Coleção):", error);
        state.students = []; 
        
        if (error.code === 'permission-denied') {
            console.warn("PERMISSÃO NEGADA: Verifique firestore.rules.");
            throw new Error("Permissão negada. Atualize o firestore.rules no Firebase Console.");
        }
        
        throw new Error("Erro ao carregar a lista de alunos da nova base de dados.");
    }
};

/**
 * (NOVO) Busca alunos no servidor pelo nome.
 * Essencial para os autocompletes funcionarem com paginação.
 * @param {string} searchName - O nome (ou parte dele) a pesquisar.
 * @returns {Promise<Array>} Lista de alunos encontrados.
 */
export const searchStudentsByName = async (searchName) => {
    if (!searchName || searchName.trim() === '') return [];

    const searchTerm = searchName.trim(); // Mantém o casing original para a query se necessário, ou normaliza
    // Nota: Firestore é case-sensitive por padrão. Para busca perfeita, precisaríamos de um campo 'nameLower'.
    // Por agora, usamos o método startAt/endAt que funciona bem se o usuário digitar as iniciais corretas.
    
    // Estratégia "prefixo": Busca nomes que começam com 'searchTerm'
    const studentsRef = getStudentsCollectionRef();
    const q = query(
        studentsRef, 
        orderBy('name'), 
        startAt(searchTerm), 
        endAt(searchTerm + '\uf8ff'),
        limit(5) // Retorna no máximo 5 sugestões
    );

    try {
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
 * Carrega as configurações da escola (nome, logo, etc.) do Firestore.
 * @returns {Promise<void>}
 */
export const loadSchoolConfig = async () => {
    try {
        const docSnap = await getDoc(getSchoolConfigDocRef());
        if (docSnap.exists()) {
            state.config = docSnap.data();
        } else {
            console.log("Nenhum documento de configuração encontrado. Usando valores padrão.");
            state.config = {
                schoolName: "EMEF. DILMA DOS SANTOS CARVALHO",
                city: "Cidade (Exemplo)",
                schoolLogoUrl: null
            };
        }
    } catch (error) {
        console.error("Erro ao carregar configurações da escola:", error);
        throw new Error("Erro ao carregar as configurações da escola.");
    }
};

/**
 * Salva as configurações da escola no Firestore.
 * @param {object} data - O objeto com os dados da configuração.
 * @returns {Promise<void>}
 */
export const saveSchoolConfig = (data) => {
    const configRef = getSchoolConfigDocRef();
    return setDoc(configRef, data, { merge: true });
};

/**
 * Busca todos os registos de ocorrência para um 'groupId' específico.
 * @param {string} groupId - O ID do grupo.
 * @returns {Promise<object|null>} Um objeto de incidente ou null.
 */
export const getIncidentByGroupId = async (groupId) => {
    const incidentQuery = query(getCollectionRef('occurrence'), where('occurrenceGroupId', '==', groupId));
    
    try {
        const querySnapshot = await getDocs(incidentQuery);
        if (querySnapshot.empty) {
            return null;
        }

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

        // (MODIFICADO V3) - Como state.students agora só tem 10 alunos,
        // precisamos buscar os dados do aluno no servidor se não estiverem no state.
        for (const participant of participantsList) {
            let student = state.students.find(s => s.matricula === participant.studentId);
            
            if (!student) {
                // Fallback: Tenta buscar o aluno individualmente no servidor
                try {
                    const studentDocRef = doc(getStudentsCollectionRef(), participant.studentId);
                    const studentSnap = await getDoc(studentDocRef);
                    if (studentSnap.exists()) {
                        student = { matricula: studentSnap.id, ...studentSnap.data() };
                    }
                } catch (e) {
                    console.error(`Erro ao buscar aluno ${participant.studentId}:`, e);
                }
            }

            if (student && !incident.participantsInvolved.has(participant.studentId)) {
                incident.participantsInvolved.set(participant.studentId, {
                    student: student,
                    role: participant.role || 'Envolvido'
                });
            }
        }

        const allResolved = incident.records.every(r => r.statusIndividual === 'Resolvido');
        incident.overallStatus = allResolved ? 'Finalizada' : 'Pendente';

        return incident;

    } catch (error) {
        console.error(`Erro ao buscar incidente por GroupId (${groupId}):`, error);
        return null;
    }
};