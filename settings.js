// =================================================================================
// ARQUIVO: settings.js
// RESPONSABILIDADE: Gerenciar a lógica e a UI do modal de Configurações.
// =================================================================================

import { state, dom } from './state.js';
import { saveSchoolConfig } from './firestore.js';
import { showToast, closeModal, openModal } from './utils.js';

/**
 * Abre o modal de configurações e preenche com os dados atuais.
 * (Movido de ui.js)
 */
const openSettingsModal = () => {
    const settingsForm = dom.settingsForm; // Usa a referência do DOM
    if (settingsForm) {
        settingsForm.reset();
    }

    document.getElementById('school-name-input').value = state.config.schoolName || '';
    document.getElementById('school-city-input').value = state.config.city || '';
    document.getElementById('school-logo-input').value = state.config.schoolLogoUrl || '';

    openModal(dom.settingsModal);
};

/**
 * Lida com a submissão do formulário de configurações.
 * (Movido de main.js)
 */
async function handleSettingsSubmit(e) {
    e.preventDefault();
    const data = {
        schoolName: document.getElementById('school-name-input').value.trim(),
        city: document.getElementById('school-city-input').value.trim(),
        schoolLogoUrl: document.getElementById('school-logo-input').value.trim()
    };

    try {
        await saveSchoolConfig(data);
        state.config = data; // Atualiza o estado local
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

