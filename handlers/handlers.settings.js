// =================================================================================
// ARQUIVO: handlers.settings.js
// RESPONSABILIDADE: Lógica de eventos para o modal "Configurações".
// (Funções movidas do main.js)
// =================================================================================

import { showToast, closeModal } from '../utils.js';
import { state, dom } from '../state.js';
import { saveSchoolConfig } from '../firestore.js';

/**
 * Lida com a submissão do formulário de Configurações.
 * (Movido do main.js)
 */
export async function handleSettingsSubmit(e) {
    e.preventDefault();
    const data = {
        schoolName: document.getElementById('school-name-input').value.trim(),
        city: document.getElementById('school-city-input').value.trim(),
        schoolLogoUrl: document.getElementById('school-logo-input').value.trim()
    };

    try {
        await saveSchoolConfig(data);
        state.config = data;
        // Atualiza o nome da escola no cabeçalho imediatamente
        if (dom.headerSchoolName) {
            dom.headerSchoolName.textContent = data.schoolName || 'Sistema de Acompanhamento';
        }
        showToast('Configurações salvas com sucesso!');
        closeModal(dom.settingsModal);
    } catch (error) {
        console.error("Erro ao salvar configurações:", error);
        showToast('Erro ao salvar as configurações.');
    }
}

