// ARQUIVO: firestore.js
// RESPONSABILIDADE: Funções de comunicação com a base de dados (CRUD - Criar, Ler, Atualizar, Excluir).

import { doc, addDoc, setDoc, deleteDoc, collection, serverTimestamp, query, getDoc, updateDoc, arrayUnion } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db } from './firebase.js';
import { state } from './state.js';

/**
 * Retorna a referência para o documento que armazena a lista de todos os alunos.
 * @returns {DocumentReference}
 */
export const getStudentsDocRef = () => {
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    return doc(db, `/artifacts/${appId}/public/data/school-data`, 'students');
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


// --- FUNÇÕES CRUD (Criar, Ler, Atualizar, Excluir) ---

/**
 * Adiciona um novo registo à base de dados.
 * Para ocorrências, adiciona automaticamente os campos de status e histórico.
 * @param {string} type - O tipo de coleção ('occurrence' ou 'absence').
 * @param {object} data - Os dados do registo a serem salvos.
 * @returns {Promise<DocumentReference>} A referência do documento criado.
 */
export const addRecord = (type, data) => {
    let finalData = { ...data, createdAt: serverTimestamp() };

    // Se o registo for uma ocorrência, inicializa com os novos campos
    if (type === 'occurrence') {
        finalData = {
            ...finalData,
            status: 'Pendente', // Status inicial padrão
            history: [
                {
                    action: 'Ocorrência registada',
                    // Usamos a data do cliente para o timestamp inicial para consistência imediata na UI
                    timestamp: new Date() 
                }
            ]
        };
    }
    
    return addDoc(getCollectionRef(type), finalData);
};

/**
 * Atualiza um registo de ocorrência, adicionando uma nova entrada ao histórico.
 * Ideal para ações como mudar o status ou registar uma impressão.
 * @param {string} id - O ID da ocorrência a ser atualizada.
 * @param {object} dataToUpdate - Os campos a serem atualizados (ex: { status: 'Concluído' }).
 * @param {string} historyAction - A descrição da ação para o histórico (ex: "Status alterado para Concluído").
 * @returns {Promise<void>}
 */
export const updateOccurrenceRecord = (id, dataToUpdate, historyAction) => {
    const occurrenceRef = doc(getCollectionRef('occurrence'), id);
    
    // Cria a nova entrada de histórico
    const newHistoryEntry = {
        action: historyAction,
        timestamp: new Date()
    };
    
    // Prepara o objeto de atualização, usando arrayUnion para adicionar ao array de histórico
    const finalUpdateData = {
        ...dataToUpdate,
        history: arrayUnion(newHistoryEntry)
    };

    // Executa a atualização no Firestore
    return updateDoc(occurrenceRef, finalUpdateData);
};


/**
 * Atualiza um registo genérico na base de dados, mesclando os dados.
 * Usado principalmente para salvar as edições do formulário principal.
 * @param {string} type - O tipo de coleção.
 * @param {string} id - O ID do documento.
 * @param {object} data - Os dados a serem mesclados.
 * @returns {Promise<void>}
 */
export const updateRecord = (type, id, data) => {
    // Usamos setDoc com 'merge: true' para garantir que não sobrescrevemos campos
    // que não estão no formulário, como o array de histórico.
    return setDoc(doc(getCollectionRef(type), id), data, { merge: true });
};


/**
 * Exclui um registo da base de dados.
 * @param {string} type - O tipo de coleção.
 * @param {string} id - O ID do documento a ser excluído.
 * @returns {Promise<void>}
 */
export const deleteRecord = (type, id) => deleteDoc(doc(getCollectionRef(type), id));

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

