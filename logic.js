// ARQUIVO: logic.js
// Responsabilidade: Lógica de negócio pura (sem DOM, sem UI).
//
// ATUALIZAÇÃO (FLUXO V3):
// 1. Adicionada a função `determineNextOccurrenceStep` para
//    suportar o novo fluxo de etapas de ocorrências.
//
// ATUALIZAÇÃO (EDIÇÃO DE AÇÃO - 01/11/2025):
// 1. Adicionadas `occurrencePreviousActionMap` e `determineCurrentActionFromStatus`
//    para permitir a edição da última ação salva no fluxo de ocorrências.
//
// ATUALIZAÇÃO (RESET DE AÇÃO - 01/11/2025):
// 1. Adicionado o mapa `occurrenceStepLogic` para definir as regras
//    de "Rollback" (resetar uma etapa, limpando dados e revertendo o status).
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

// --- (NOVO - Edição de Ação 01/11/2025) ---
// Esta seção implementa a lógica para PERMITIR A EDIÇÃO
// da última ação individual que o usuário salvou.
// ==============================================================================

// Mapeia o STATUS ATUAL para a AÇÃO ANTERIOR (a que acabou de ser salva)
// Isso permite ao sistema saber qual tela abrir para edição.
const occurrencePreviousActionMap = {
    'Aguardando Convocação': null, // Não há ação anterior para editar (use "Editar Fato")
    'Aguardando Contato': 'convocacao', // Ação 2 (convocacao) foi a última salva
    'Aguardando Desfecho': 'contato_familia', // Ação 3 (contato_familia) foi a última salva
    'Aguardando Devolutiva CT': 'desfecho_ou_ct', // Ação 4 (CT) foi a última salva
    'Aguardando Parecer Final': 'devolutiva_ct', // Ação 5 (devolutiva_ct) foi a última salva
    'Resolvido': 'parecer_final' // Ação 6 (parecer_final) foi a última salva
};

/**
 * (NOVO - Edição) Determina qual ação deve ser aberta para EDIÇÃO
 * com base no status individual atual.
 * @param {string} currentStatus - O status atual (ex: 'Aguardando Contato').
 * @returns {string|null} O tipo da ação para editar (ex: 'convocacao') ou null.
 */
export const determineCurrentActionFromStatus = (currentStatus) => {
    if (!currentStatus) {
        return null;
    }
    // Casos especiais para "Resolvido"
    if (currentStatus === 'Resolvido') {
        // Se o status for "Resolvido", a última ação foi o "parecer_final".
        // O arquivo 'occurrence.js' irá refinar isso para saber se
        // deve abrir a Ação 6 ou a Ação 4/6 (desfecho_ou_ct).
        return 'parecer_final';
    }
    // Para todos os outros status, consulta o mapa.
    // Ex: Se o status é 'Aguardando Contato', o mapa retorna 'convocacao',
    // indicando que a Ação 2 (convocacao) é a que deve ser editada.
    return occurrencePreviousActionMap[currentStatus] || null;
};


// --- (NOVO - Reset de Ação 01/11/2025) ---
// Esta seção implementa a lógica para "Resetar" (Desfazer)
// uma etapa, limpando os dados e revertendo o status em cascata.
// ==============================================================================

// Define quais campos do banco de dados devem ser limpos (setados para null)
// e para qual status o processo deve reverter ao resetar uma etapa.
// A lógica é CASCATA: resetar a Ação 3 também limpa os campos da 4, 5 e 6.
const camposAcao6 = ['parecerFinal'];
const camposAcao5 = ['ctFeedback', ...camposAcao6];
const camposAcao4_6 = ['oficioNumber', 'oficioYear', 'ctSentDate', 'desfechoChoice', ...camposAcao5]; // 'parecerFinal' já está em camposAcao5
const camposAcao3 = ['contactSucceeded', 'contactType', 'contactDate', 'providenciasFamilia', ...camposAcao4_6];
const camposAcao2 = ['meetingDate', 'meetingTime', ...camposAcao3];

export const occurrenceStepLogic = {
    // Ação 2: Convocação
    'convocacao': {
        fieldsToClear: camposAcao2,
        statusAfterReset: 'Aguardando Convocação' // Reverte para o status inicial
    },
    // Ação 3: Contato com Família
    'contato_familia': {
        fieldsToClear: camposAcao3,
        statusAfterReset: 'Aguardando Contato' // Reverte para o status da Ação 2
    },
    // Ação 4/6: Desfecho (CT ou Parecer)
    'desfecho_ou_ct': {
        fieldsToClear: camposAcao4_6,
        statusAfterReset: 'Aguardando Desfecho' // Reverte para o status da Ação 3
    },
    // Ação 5: Devolutiva do CT
    'devolutiva_ct': {
        fieldsToClear: camposAcao5,
        statusAfterReset: 'Aguardando Devolutiva CT' // Reverte para o status da Ação 4
    },
    // Ação 6: Parecer Final (Pós-CT)
    'parecer_final': {
        fieldsToClear: camposAcao6,
        statusAfterReset: 'Aguardando Parecer Final' // Reverte para o status da Ação 5
    }
};

