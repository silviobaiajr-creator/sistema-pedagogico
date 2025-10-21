// =================================================================================
// ARQUIVO: firestore.js
// RESPONSABILIDADE: Funções de comunicação com a base de dados (CRUD).
// ATUALIZAÇÃO GERAL (Conforme Análise):
// 1. (Item 6) `addRecord` e `updateRecord` foram substituídos por
//    `addRecordWithHistory` e `updateRecordWithHistory` para adicionar
//    histórico de auditoria a todos os registros (Ocorrências e Busca Ativa).
// 2. (Item 8) Nova função `getCounterDocRef` para suportar a geração
//    de IDs sequenciais para ocorrências.
// 3. (Item 5) Novas funções `getSchoolConfigDocRef` e `loadSchoolConfig`
//    para carregar dinamicamente as configurações da escola (nome, logo).
// 4. (Problema 3) Adicionada a nova função `saveSchoolConfig` para persistir
//    as configurações da escola no banco de dados.
// 5. Funções foram refatoradas para maior clareza e reutilização.
// =================================================================================

import { doc, addDoc, setDoc, deleteDoc, collection, getDoc, updateDoc, arrayUnion } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db } from './firebase.js';
import { state } from './state.js';

// --- FUNÇÕES DE REFERÊNCIA (Caminhos para os dados) ---

/**
 * Retorna a referência para o documento que armazena a lista de todos os alunos.
 * @returns {DocumentReference}
 */
export const getStudentsDocRef = () => {
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    return doc(db, `/artifacts/${appId}/public/data/school-data`, 'students');
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
 * Carrega a lista de alunos do Firestore e a armazena no estado global.
 * @returns {Promise<void>}
 */
export const loadStudents = async () => {
    try {
        const docSnap = await getDoc(getStudentsDocRef());
        if (docSnap.exists() && docSnap.data().list) {
            state.students = docSnap.data().list;
        } else {
            console.log("Nenhuma lista de alunos encontrada no Firestore.");
            state.students = [];
        }
    } catch (error) {
        console.error("Erro ao carregar lista de alunos:", error);
        throw new Error("Erro ao carregar a lista de alunos.");
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
            // Define valores padrão se nada for encontrado
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
 * NOVO (Problema 3): Salva as configurações da escola no Firestore.
 * @param {object} data - O objeto com os dados da configuração (schoolName, city, schoolLogoUrl).
 * @returns {Promise<void>}
 */
export const saveSchoolConfig = (data) => {
    const configRef = getSchoolConfigDocRef();
    // Usa setDoc com 'merge: true' para não sobrescrever outros campos que possam existir no futuro.
    return setDoc(configRef, data, { merge: true });
};
