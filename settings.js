// =================================================================================
// ARQUIVO: settings.js

import { state, dom } from './state.js';
import { saveSchoolConfig } from './firestore.js';
import { showToast, closeModal, openModal } from './utils.js';

/**
 * Abre o modal de configurações e preenche com os dados atuais.
 * (Movido de ui.js)
 * (MODIFICADO - Híbrida Admin)
 */
const openSettingsModal = () => {
    const settingsForm = dom.settingsForm; // Usa a referência do DOM
    if (settingsForm) {
        settingsForm.reset();
    }

    document.getElementById('school-name-input').value = state.config.schoolName || '';
    document.getElementById('school-city-input').value = state.config.city || '';
    document.getElementById('school-logo-input').value = state.config.schoolLogoUrl || '';
    
    // (ADICIONADO - Híbrida Admin) Preenche a lista de emails de admin
    // Converte o array ['a@b.com', 'c@d.com'] para a string "a@b.com, c@d.com"
    document.getElementById('admin-emails-input').value = (state.config.adminEmails || []).join(', ');

    openModal(dom.settingsModal);
};

/**
 * Lida com a submissão do formulário de configurações.
 * (Movido de main.js)
 * (MODIFICADO - Híbrida Admin)
 */
async function handleSettingsSubmit(e) {
    e.preventDefault();
    
    // (ADICIONADO - Híbrida Admin) Processa a lista de emails
    const emailsText = document.getElementById('admin-emails-input').value.trim();
    // Converte a string "a@b.com, c@d.com" para o array ['a@b.com', 'c@d.com']
    const adminEmails = emailsText
        .split(',') // Divide por vírgula
        .map(email => email.trim()) // Remove espaços em branco
        .filter(email => email.length > 0); // Remove entradas vazias

    const data = {
        schoolName: document.getElementById('school-name-input').value.trim(),
        city: document.getElementById('school-city-input').value.trim(),
        schoolLogoUrl: document.getElementById('school-logo-input').value.trim(),
        adminEmails: adminEmails // (ADICIONADO) Salva o array de emails
    };

    try {
        await saveSchoolConfig(data);
        state.config = data; // Atualiza o estado local (INCLUINDO adminEmails)
        dom.headerSchoolName.textContent = data.schoolName || 'Sistema de Acompanhamento'; // Atualiza a UI imediatamente
        showToast('Configurações salvas com sucesso!');
        closeModal(dom.settingsModal);
    } catch (error) {
        console.error("Erro ao salvar configurações:", error);
        showToast('Erro ao salvar as configurações.');
    }
}

/**
 * Função principal do módulo: anexa os listeners de eventos
 * aos elementos de Configurações.
 */
export const initSettingsListeners = () => {
    const { settingsBtn, settingsForm } = dom;

    if (settingsBtn) {
        settingsBtn.addEventListener('click', openSettingsModal);
    }

    if (settingsForm) {
        settingsForm.addEventListener('submit', handleSettingsSubmit);
    }
    
    // Os botões de fechar/cancelar já são tratados pelo `setupModalCloseButtons` no main.js
};
