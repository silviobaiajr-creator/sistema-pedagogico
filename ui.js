// =================================================================================
// ARQUIVO: ui.js (REFATORADO)
// RESPONSABILIDADE: Função de renderização principal que orquestra
// qual módulo de funcionalidade (occurrence.js ou absence.js)
// deve desenhar seu conteúdo na tela.
// =================================================================================

import { state } from './state.js';
// Importa as funções de renderização específicas dos novos módulos
import { renderOccurrences } from './occurrence.js';
import { renderAbsences } from './absence.js';

// (Todas as outras funções de UI foram movidas para occurrence.js ou absence.js)

/**
 * Função central que decide qual conteúdo de aba deve ser renderizado.
 */
export const render = () => {
    if (state.activeTab === 'occurrences') {
        renderOccurrences();
    } else {
        renderAbsences();
    }
};
