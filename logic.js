// =================================================================================
// ARQUIVO: logic.js
// =================================================================================

import { state } from './state.js';
// (NOVO) Importa getStatusBadge para uso na filtragem (quebra de ciclo)
import { getStatusBadge } from './utils.js';

// --- CONSTANTES COMPARTILHADAS (Movidas de occurrence.js para corrigir dependência circular) ---

export const roleIcons = {
    'Vítima': 'fas fa-user-shield text-blue-600',
    'Agente': 'fas fa-gavel text-red-600', 
    'Testemunha': 'fas fa-eye text-green-600',
    'Envolvido': 'fas fa-user text-gray-500'
};

export const defaultRole = 'Envolvido'; 

// --- (NOVO) FUNÇÃO DE PROCESSAMENTO DE OCORRÊNCIAS ---
// Movida de occurrence.js para o "cérebro" (logic.js) para estar disponível globalmente
// sem causar erros de importação no reports.js
// ------------------------------------------------------------------------------

/**
 * Processa os dados brutos das ocorrências, agrupa por incidente e aplica filtros.
 * Retorna um Map onde a chave é o ID do Grupo e o valor é o objeto do incidente.
 */
export const getFilteredOccurrences = () => {
    // 1. Agrupamento
    const groupedByIncident = state.occurrences.reduce((acc, occ) => {
        if (!occ || !occ.studentId) return acc;

        const groupId = occ.occurrenceGroupId || `individual-${occ.id}`;
        if (!acc.has(groupId)) {
            acc.set(groupId, {
                id: groupId,
                records: [],
                participantsInvolved: new Map(),
                overallStatus: 'Aguardando Convocação'
            });
        }
        const incident = acc.get(groupId);
        incident.records.push(occ);

        // Tenta recuperar o papel salvo no registo ou usa o padrão
        const participantData = occ.participants?.find(p => p.studentId === occ.studentId);
        const student = state.students.find(s => s.matricula === occ.studentId);

        if (student && !incident.participantsInvolved.has(student.matricula)) {
             incident.participantsInvolved.set(student.matricula, {
                 student: student,
                 role: participantData?.role || defaultRole 
             });
        }
        return acc;
    }, new Map());

    // 2. Filtragem
    const filteredIncidents = new Map();
    for (const [groupId, incident] of groupedByIncident.entries()) {
        const mainRecord = incident.records && incident.records.length > 0 ? incident.records[0] : null;
        if (!mainRecord) continue;

        const { startDate, endDate, status, type } = state.filtersOccurrences;
        const studentSearch = state.filterOccurrences.toLowerCase();

        // Recalcula status geral
        const allResolved = incident.records.every(r => r.statusIndividual === 'Resolvido');
        incident.overallStatus = allResolved ? 'Finalizada' : 'Pendente';

        // Filtros de Data, Tipo e Status
        if (startDate && mainRecord.date < startDate) continue;
        if (endDate && mainRecord.date > endDate) continue;
        if (status !== 'all' && incident.overallStatus !== status) continue;
        if (type !== 'all' && mainRecord.occurrenceType !== type) continue;

        // Filtro de Texto (Busca por nome do aluno)
        if (studentSearch) {
            const hasMatchingStudent = [...incident.participantsInvolved.values()].some(p =>
                p.student.name.toLowerCase().includes(studentSearch)
            );
            if (!hasMatchingStudent) continue;
        }
        filteredIncidents.set(groupId, incident);
    }
    return filteredIncidents;
};


// --- Lógica da Busca Ativa (Mantida) ---

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
// --- Lógica das Ocorrências (3 Tentativas) ---
// ==============================================================================

const occurrenceNextActionMap = {
    'Aguardando Convocação': 'convocacao', 
    'Aguardando Contato 1': 'contato_familia_1', 
    'Aguardando Contato 2': 'contato_familia_2', 
    'Aguardando Contato 3': 'contato_familia_3', 
    'Aguardando Desfecho': 'desfecho_ou_ct', 
    'Aguardando Devolutiva CT': 'devolutiva_ct', 
    'Aguardando Parecer Final': 'parecer_final', 
    'Resolvido': null
};

export const determineNextOccurrenceStep = (currentStatus) => {
    if (!currentStatus) return 'convocacao'; 
    return occurrenceNextActionMap[currentStatus] || null;
};

const occurrencePreviousActionMap = {
    'Aguardando Convocação': null, 
    'Aguardando Contato 1': 'convocacao', 
    'Aguardando Contato 2': 'contato_familia_1', 
    'Aguardando Contato 3': 'contato_familia_2', 
    'Aguardando Desfecho': 'contato_familia_x', 
    'Aguardando Devolutiva CT': 'desfecho_ou_ct',
    'Aguardando Parecer Final': 'devolutiva_ct',
    'Resolvido': 'parecer_final'
};

export const determineCurrentActionFromStatus = (currentStatus) => {
    if (!currentStatus) return null;
    if (currentStatus === 'Resolvido') return 'parecer_final';
    if (currentStatus === 'Aguardando Desfecho') return 'contato_familia_x'; 
    return occurrencePreviousActionMap[currentStatus] || null;
};

// ==============================================================================
// --- Lógica de Reset (Cascata de Exclusão) ---
// ==============================================================================

const camposAcao6 = ['parecerFinal'];
const camposAcao5 = ['ctFeedback', ...camposAcao6];
const camposAcao4_6 = ['oficioNumber', 'oficioYear', 'ctSentDate', 'desfechoChoice', ...camposAcao5]; 
const camposAcao3_3 = ['contactSucceeded_3', 'contactType_3', 'contactDate_3', 'providenciasFamilia_3', ...camposAcao4_6];
const camposAcao3_2 = ['contactSucceeded_2', 'contactType_2', 'contactDate_2', 'providenciasFamilia_2', ...camposAcao3_3];
const camposAcao3_1 = ['contactSucceeded_1', 'contactType_1', 'contactDate_1', 'providenciasFamilia_1', ...camposAcao3_2];
const camposAcao2 = ['meetingDate', 'meetingTime', ...camposAcao3_1];

export const occurrenceStepLogic = {
    'convocacao': { fieldsToClear: camposAcao2, statusAfterReset: 'Aguardando Convocação' },
    'contato_familia_1': { fieldsToClear: camposAcao3_1, statusAfterReset: 'Aguardando Contato 1' },
    'contato_familia_2': { fieldsToClear: camposAcao3_2, statusAfterReset: 'Aguardando Contato 2' },
    'contato_familia_3': { fieldsToClear: camposAcao3_3, statusAfterReset: 'Aguardando Contato 3' },
    'desfecho_ou_ct': { fieldsToClear: camposAcao4_6, statusAfterReset: 'Aguardando Desfecho' },
    'devolutiva_ct': { fieldsToClear: camposAcao5, statusAfterReset: 'Aguardando Devolutiva CT' },
    'parecer_final': { fieldsToClear: camposAcao6, statusAfterReset: 'Aguardando Parecer Final' }
};