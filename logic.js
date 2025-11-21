// ARQUIVO: logic.js

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
// --- (NOVO V4) Lógica das Ocorrências (3 Tentativas) ---
// ==============================================================================

// Mapeia o STATUS ATUAL para a PRÓXIMA AÇÃO (Botão "Avançar")
const occurrenceNextActionMap = {
    'Aguardando Convocação': 'convocacao', // Inicia Ação 2
    'Aguardando Contato 1': 'contato_familia_1', // Inicia Tentativa 1
    'Aguardando Contato 2': 'contato_familia_2', // Inicia Tentativa 2 (se T1 falhou)
    'Aguardando Contato 3': 'contato_familia_3', // Inicia Tentativa 3 (se T2 falhou)
    'Aguardando Desfecho': 'desfecho_ou_ct', // Inicia Ação 4 ou 6
    'Aguardando Devolutiva CT': 'devolutiva_ct', // Inicia Ação 5
    'Aguardando Parecer Final': 'parecer_final', // Inicia Ação 6 (pós CT)
    'Resolvido': null
};

/**
 * Determina qual é a próxima ação de ocorrência com base no status.
 */
export const determineNextOccurrenceStep = (currentStatus) => {
    if (!currentStatus) return 'convocacao'; 
    return occurrenceNextActionMap[currentStatus] || null;
};

// ==============================================================================
// --- Lógica de Edição (Voltar para editar a última ação) ---
// ==============================================================================

// Mapeia o STATUS ATUAL para a AÇÃO ANTERIOR (Botão "Editar Ação")
const occurrencePreviousActionMap = {
    'Aguardando Convocação': null, 
    'Aguardando Contato 1': 'convocacao', // Se está esperando T1, a última coisa feita foi Convocação
    'Aguardando Contato 2': 'contato_familia_1', // Se está esperando T2, a última foi T1 (falha)
    'Aguardando Contato 3': 'contato_familia_2', // Se está esperando T3, a última foi T2 (falha)
    'Aguardando Desfecho': 'contato_familia_x', // *Caso especial: pode ser T1, T2 ou T3. Ocorrência.js resolve.
    'Aguardando Devolutiva CT': 'desfecho_ou_ct',
    'Aguardando Parecer Final': 'devolutiva_ct',
    'Resolvido': 'parecer_final'
};

/**
 * Determina qual ação deve ser aberta para EDIÇÃO.
 */
export const determineCurrentActionFromStatus = (currentStatus) => {
    if (!currentStatus) return null;
    
    // Casos especiais
    if (currentStatus === 'Resolvido') return 'parecer_final';
    if (currentStatus === 'Aguardando Desfecho') {
        // Retorna um marcador genérico. O occurrence.js verificará qual contato existe (3, 2 ou 1)
        return 'contato_familia_x'; 
    }

    return occurrencePreviousActionMap[currentStatus] || null;
};


// ==============================================================================
// --- Lógica de Reset (Cascata de Exclusão) ---
// ==============================================================================

// Definição dos campos no banco de dados (Usaremos sufixos _1, _2, _3 no occurrence.js)
const camposAcao6 = ['parecerFinal'];
const camposAcao5 = ['ctFeedback', ...camposAcao6];
const camposAcao4_6 = ['oficioNumber', 'oficioYear', 'ctSentDate', 'desfechoChoice', ...camposAcao5]; 

// Tentativa 3 limpa o desfecho
const camposAcao3_3 = ['contactSucceeded_3', 'contactType_3', 'contactDate_3', 'providenciasFamilia_3', ...camposAcao4_6];
// Tentativa 2 limpa a 3 + desfecho
const camposAcao3_2 = ['contactSucceeded_2', 'contactType_2', 'contactDate_2', 'providenciasFamilia_2', ...camposAcao3_3];
// Tentativa 1 limpa a 2 + 3 + desfecho
const camposAcao3_1 = ['contactSucceeded_1', 'contactType_1', 'contactDate_1', 'providenciasFamilia_1', ...camposAcao3_2];

const camposAcao2 = ['meetingDate', 'meetingTime', ...camposAcao3_1];

export const occurrenceStepLogic = {
    'convocacao': {
        fieldsToClear: camposAcao2,
        statusAfterReset: 'Aguardando Convocação'
    },
    'contato_familia_1': {
        fieldsToClear: camposAcao3_1,
        statusAfterReset: 'Aguardando Contato 1' // Volta para o status definido pela Convocação
    },
    'contato_familia_2': {
        fieldsToClear: camposAcao3_2,
        statusAfterReset: 'Aguardando Contato 2' // Volta para o status definido pela falha da T1
    },
    'contato_familia_3': {
        fieldsToClear: camposAcao3_3,
        statusAfterReset: 'Aguardando Contato 3' // Volta para o status definido pela falha da T2
    },
    'desfecho_ou_ct': {
        fieldsToClear: camposAcao4_6,
        statusAfterReset: 'Aguardando Desfecho'
    },
    'devolutiva_ct': {
        fieldsToClear: camposAcao5,
        statusAfterReset: 'Aguardando Devolutiva CT'
    },
    'parecer_final': {
        fieldsToClear: camposAcao6,
        statusAfterReset: 'Aguardando Parecer Final'
    }
};