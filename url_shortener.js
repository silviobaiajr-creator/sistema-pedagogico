
// =================================================================================
// ARQUIVO: url_shortener.js
// FUNÇÃO: Gerenciamento de Links Curtos (Internal Shortener)
// =================================================================================

import { db } from './firebase.js';
import {
    doc, setDoc, getDoc, collection, query, where, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const getShortLinksCollection = () => {
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    return collection(db, `/artifacts/${appId}/public/data/short_links`);
};

/**
 * Gera um código alfanumérico aleatório de 6 caracteres.
 * Ex: A7B9X2
 */
const generateRandomCode = (length = 6) => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Remove I, 1, O, 0 to avoid confusion
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};

/**
 * Cria ou recupera um link curto para um Document ID.
 * @param {string} docId - O ID real do Firestore do documento.
 * @returns {Promise<string>} - O código curto (Ex: "X9A2B3").
 */
export const getOrCreateShortLink = async (docId) => {
    try {
        const colRef = getShortLinksCollection();

        // 1. Verifica se já existe um código para este docId (Evita duplicatas)
        const q = query(colRef, where('targetDocId', '==', docId));
        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
            // Retorna o código existente
            return snapshot.docs[0].id; // Usamos o ID do documento como o próprio código
        }

        // 2. Gera um novo código único
        let code = generateRandomCode();
        let isUnique = false;
        let attempts = 0;

        while (!isUnique && attempts < 5) {
            const docRef = doc(colRef, code);
            const docSnap = await getDoc(docRef);
            if (!docSnap.exists()) {
                isUnique = true;
            } else {
                code = generateRandomCode();
                attempts++;
            }
        }

        if (!isUnique) throw new Error("Falha ao gerar código único após várias tentativas.");

        // 3. Salva o mapeamento
        await setDoc(doc(colRef, code), {
            targetDocId: docId,
            createdAt: new Date()
        });

        return code;

    } catch (error) {
        console.error("Erro ao gerar link curto:", error);
        return null;
    }
};

/**
 * Resolve um código curto para o Document ID real.
 * @param {string} code - O código curto (Ex: "X9A2B3").
 * @returns {Promise<string|null>} - O DocID ou null se não encontrado.
 */
export const resolveShortCode = async (code) => {
    if (!code || code.length < 4) return null;

    try {
        const docRef = doc(getShortLinksCollection(), code.toUpperCase().trim());
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            return docSnap.data().targetDocId;
        }
        return null;
    } catch (error) {
        console.error("Erro ao resolver link curto:", error);
        return null;
    }
};
