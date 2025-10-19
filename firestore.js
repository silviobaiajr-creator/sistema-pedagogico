// ARQUIVO: firestore.js
// Responsabilidade: Funções de comunicação com o banco de dados (CRUD).

import { doc, addDoc, setDoc, deleteDoc, collection, serverTimestamp, query, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db } from './firebase.js';
import { state } from './state.js';

export const getStudentsDocRef = () => {
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    return doc(db, `/artifacts/${appId}/public/data/school-data`, 'students');
};

export const getCollectionRef = (type) => {
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    const collectionName = type === 'occurrence' ? 'occurrences' : 'absences';
    return collection(db, `/artifacts/${appId}/public/data/${collectionName}`);
};

export const addRecord = (type, data) => addDoc(getCollectionRef(type), { ...data, createdAt: serverTimestamp() });
export const updateRecord = (type, id, data) => setDoc(doc(getCollectionRef(type), id), data, { merge: true });
export const deleteRecord = (type, id) => deleteDoc(doc(getCollectionRef(type), id));

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

