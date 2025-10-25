// ARQUIVO: logic.js
// Responsabilidade: Lógica de negócio pura (sem DOM, sem UI).
//
// ATUALIZAÇÃO (FLUXO V3):
// 1. Adicionada a função `determineNextOccurrenceStep` para
//    suportar o novo fluxo de etapas de ocorrências.
// =================================================================================

import { state } from './state.js';

// --- Lógica da Busca Ativa ---

export const getStudentProcessInfo = (studentId) => {
    const studentActions = state.absences
        .filter(a => a.studentId === studentId)
        .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));

    let lastAnaliseIndex = -1;
    for (let i = studentActions.length - 1; i >= 0; i--) {
        if (studentActions[i].actionType === 'analise') {
            lastAnaliseIndex = i;
            break;
        }
    }
    
    const currentCycleActions = studentActions.slice(lastAnaliseIndex + 1);
    
    let processId;
    const existingProcessAction = currentCycleActions.find(a => a.processId);

    if (existingProcessAction) {
        processId = existingProcessAction.processId;
    } else {
        const allProcessIdsForStudent = state.absences.filter(a => a.studentId === studentId)
            .map(a => a.processId)
            .filter(Boolean);
        
        const processNumbers = allProcessIdsForStudent
            .map(pid => parseInt(pid.split('-')[1] || 0, 10))
            .filter(num => !isNaN(num));
            
        const maxNumber = processNumbers.length > 0 ? Math.max(...processNumbers) : 0;
        processId = `${studentId}-${maxNumber + 1}`;
    }

    return {
        currentCycleActions,
        processId
    };
};

export const determineNextActionForStudent = (studentId) => {
    const { currentCycleActions } = getStudentProcessInfo(studentId);
    const sequence = ['tentativa_1', 'tentativa_2', 'tentativa_3', 'visita', 'encaminhamento_ct', 'analise'];
    const existingActionTypes = new Set(currentCycleActions.map(a => a.actionType));

    const hasReturnedInCurrentCycle = currentCycleActions.some(
        a => a.contactReturned === 'yes' || a.visitReturned === 'yes' || a.ctReturned === 'yes'
    );

    if (hasReturnedInCurrentCycle && !existingActionTypes.has('analise')) {
        return 'analise';
    }

    for (const action of sequence) {
        if (!existingActionTypes.has(action)) {
            return action;
        }
    }
    
    return 'analise'; // Fallback
};


// ==============================================================================
// --- (NOVO V3) Lógica das Ocorrências ---
// ==============================================================================

// Mapeia o STATUS ATUAL para a PRÓXIMA AÇÃO (Ação 2-6)
// Esta lógica será usada pela nova função abaixo.
const occurrenceNextActionMap = {
    'Aguardando Convocação': 'convocacao', // Ação 2
    'Aguardando Contato': 'contato_familia', // Ação 3
    'Aguardando Desfecho': 'desfecho_ou_ct', // Ação 4 ou 6 (caso especial)
    'Aguardando Devolutiva CT': 'devolutiva_ct', // Ação 5
    'Aguardando Parecer Final': 'parecer_final', // Ação 6
    'Resolvido': null // Processo finalizado
};

/**
 * (NOVO V3) Determina qual é a próxima ação de ocorrência com base
 * no status individual do aluno.
 * @param {string} currentStatus - O status atual (ex: 'Aguardando Convocação').
 * @returns {string|null} O tipo da próxima ação (ex: 'convocacao') ou null se finalizado.
 */
export const determineNextOccurrenceStep = (currentStatus) => {
    if (!currentStatus) {
        // Se o status for nulo ou indefinido, assume que é o início do processo
        return 'convocacao'; 
    }
    
    // Retorna a próxima ação com base no mapa, ou null se não houver (ex: 'Resolvido')
    return occurrenceNextActionMap[currentStatus] || null;
};
