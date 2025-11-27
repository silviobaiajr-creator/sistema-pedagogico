
// =================================================================================
// ARQUIVO: settings.js

import { state, dom } from './state.js';
import { saveSchoolConfig, getCollectionRef, getStudentsCollectionRef } from './firestore.js';
import { showToast, closeModal, openModal, showAlert } from './utils.js';
import { writeBatch, doc, collection } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from './firebase.js';

/**
 * Abre o modal de configurações e preenche com os dados atuais.
 */
const openSettingsModal = () => {
    const settingsForm = dom.settingsForm; 
    if (settingsForm) {
        settingsForm.reset();
    }

    document.getElementById('school-name-input').value = state.config.schoolName || '';
    document.getElementById('school-city-input').value = state.config.city || '';
    document.getElementById('school-logo-input').value = state.config.schoolLogoUrl || '';
    
    document.getElementById('admin-emails-input').value = (state.config.adminEmails || []).join(', ');

    openModal(dom.settingsModal);
};

/**
 * Lida com a submissão do formulário de configurações.
 */
async function handleSettingsSubmit(e) {
    e.preventDefault();
    
    const emailsText = document.getElementById('admin-emails-input').value.trim();
    const adminEmails = emailsText
        .split(',') 
        .map(email => email.trim()) 
        .filter(email => email.length > 0); 

    const data = {
        schoolName: document.getElementById('school-name-input').value.trim(),
        city: document.getElementById('school-city-input').value.trim(),
        schoolLogoUrl: document.getElementById('school-logo-input').value.trim(),
        adminEmails: adminEmails 
    };

    try {
        await saveSchoolConfig(data);
        state.config = data; 
        dom.headerSchoolName.textContent = data.schoolName || 'Sistema de Acompanhamento'; 
        showToast('Configurações salvas com sucesso!');
        closeModal(dom.settingsModal);
    } catch (error) {
        console.error("Erro ao salvar configurações:", error);
        showToast('Erro ao salvar as configurações.');
    }
}

/**
 * Função principal do módulo: anexa os listeners de eventos
 */
export const initSettingsListeners = () => {
    const { settingsBtn, settingsForm } = dom;

    if (settingsBtn) {
        settingsBtn.addEventListener('click', openSettingsModal);
    }

    if (settingsForm) {
        settingsForm.addEventListener('submit', handleSettingsSubmit);
    }
};
