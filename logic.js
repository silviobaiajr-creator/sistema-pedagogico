// =================================================================================
// ARQUIVO: logic.js
// VERSÃO: 2.2 (Resiliente a Paginação)

import { state } from './state.js';
import { getStatusBadge } from './utils.js';

// --- CONSTANTES COMPARTILHADAS ---

export const roleIcons = {
    'Vítima': 'fas fa-user-shield text-blue-600',
    'Agente': 'fas fa-gavel text-red-600', 
    'Testemunha': 'fas fa-eye text-green-600',
    'Envolvido': 'fas fa-user text-gray-500'
};

export const defaultRole = 'Envolvido'; 

// --- FUNÇÃO DE PROCESSAMENTO DE OCORRÊNCIAS (OTIMIZADA) ---

/**
 * Processa os dados brutos das ocorrências, agrupa por incidente e aplica filtros.
 * Retorna um Map onde a chave é o ID do Grupo e o valor é o objeto do incidente.
 */
export const getFilteredOccurrences = () => {
    const groupedByIncident = new Map();

    for (const occ of state.occurrences) {
        if (!occ || !occ.studentId) continue;

        const groupId = occ.occurrenceGroupId || `individual-${occ.id}`;
        
        let incident = groupedByIncident.get(groupId);
        if (!incident) {
            incident = {
                id: groupId,
                records: [],
                participantsInvolved: new Map(),
                overallStatus: 'Aguardando Convocação'
            };
            groupedByIncident.set(groupId, incident);
        }
        
        incident.records.push(occ);

        // (CORREÇÃO) Lógica resiliente para alunos não carregados (paginação)
        if (!incident.participantsInvolved.has(occ.studentId)) {
            // 1. Tenta encontrar na lista carregada
            let student = state.students.find(s => s.matricula === occ.studentId);
            
            // 2. Se não achar, cria um Placeholder para não quebrar a UI
            if (!student) {
                // Tenta usar o nome salvo no próprio registro de ocorrência (se existir futuramente) ou usa ID
                // Verificamos se temos esse aluno no cache de seleção (state.selectedStudents pode ter sobras)
                if (state.selectedStudents && state.selectedStudents.has(occ.studentId)) {
                     student = state.selectedStudents.get(occ.studentId).student;
                } else {
                     student = {
                        matricula: occ.studentId,
                        name: `Aluno (${occ.studentId})`, // Nome provisório
                        class: '?',
                        isPlaceholder: true // Marca para saber que não é completo
                    };
                }
            }

            const participantData = occ.participants?.find(p => p.studentId === occ.studentId);
            
            incident.participantsInvolved.set(occ.studentId, {
                student: student,
                role: participantData?.role || defaultRole 
            });
        }
    }

    // 2. Filtragem e Processamento
    const filteredIncidents = new Map();
    const { startDate, endDate, status, type } = state.filtersOccurrences;
    // Normalização para busca segura
    const studentSearchRaw = state.filterOccurrences || '';
    const studentSearch = studentSearchRaw.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    for (const [groupId, incident] of groupedByIncident.entries()) {
        const mainRecord = incident.records && incident.records.length > 0 ? incident.records[0] : null;
        if (!mainRecord) continue;

        // Recalcula status geral
        const allResolved = incident.records.every(r => r.statusIndividual === 'Resolvido');
        incident.overallStatus = allResolved ? 'Finalizada' : 'Pendente';

        // Filtros Rápidos (Short-circuit)
        if (status !== 'all' && incident.overallStatus !== status) continue;
        if (type !== 'all' && mainRecord.occurrenceType !== type) continue;
        if (startDate && mainRecord.date < startDate) continue;
        if (endDate && mainRecord.date > endDate) continue;

        // Filtro de Texto (Busca por nome do aluno)
        if (studentSearch) {
            let hasMatchingStudent = false;
            for (const p of incident.participantsInvolved.values()) {
                const pName = p.student.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                // Se for placeholder, permite buscar pelo ID também
                if (pName.includes(studentSearch) || p.student.matricula.includes(studentSearch)) {
                    hasMatchingStudent = true;
                    break;
                }
            }
            if (!hasMatchingStudent) continue;
        }
        filteredIncidents.set(groupId, incident);
    }
    return filteredIncidents;
};


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
        const allProcessIdsForStudent = state.absences
            .filter(a => a.studentId === studentId)
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
    
    return 'analise'; 
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
// --- VALIDAÇÃO DE CRONOLOGIA ---
// ==============================================================================

const getActionMainDate = (action) => {
    if (!action) return null;
    switch (action.actionType) {
        case 'tentativa_1': case 'tentativa_2': case 'tentativa_3':
            return action.contactDate || action.meetingDate;
        case 'visita': return action.visitDate;
        case 'encaminhamento_ct': return action.ctSentDate;
        case 'analise': return action.createdAt?.toDate ? action.createdAt.toDate().toISOString().split('T')[0] : null;
        default: return null;
    }
};

export const validateOccurrenceChronology = (record, actionType, newDate) => {
    if (!newDate) return { isValid: true, message: '' };

    const dateToCheck = new Date(newDate + 'T00:00:00'); 
    const occurrenceDate = new Date(record.date + 'T00:00:00');

    if (dateToCheck < occurrenceDate) {
        return { isValid: false, message: `A data não pode ser anterior à data da Ocorrência (${record.date}).` };
    }

    if (actionType === 'contato_familia_1') {
        if (record.meetingDate) {
            const meetingDate = new Date(record.meetingDate + 'T00:00:00');
            if (dateToCheck < meetingDate) return { isValid: false, message: `A 1ª Tentativa não pode ser anterior à Convocação (${record.meetingDate}).` };
        }
    }
    if (actionType === 'contato_familia_2') {
        const prevDateStr = record.contactDate_1 || record.meetingDate;
        if (prevDateStr) {
            const prevDate = new Date(prevDateStr + 'T00:00:00');
            if (dateToCheck < prevDate) return { isValid: false, message: `A 2ª Tentativa não pode ser anterior à 1ª Tentativa ou Convocação (${prevDateStr}).` };
        }
    }
    if (actionType === 'contato_familia_3') {
        const prevDateStr = record.contactDate_2 || record.contactDate_1;
        if (prevDateStr) {
            const prevDate = new Date(prevDateStr + 'T00:00:00');
            if (dateToCheck < prevDate) return { isValid: false, message: `A 3ª Tentativa não pode ser anterior à tentativa passada (${prevDateStr}).` };
        }
    }
    if (actionType === 'desfecho_ou_ct' || actionType === 'devolutiva_ct') {
        const lastContactDate = record.contactDate_3 || record.contactDate_2 || record.contactDate_1 || record.meetingDate;
        if (lastContactDate) {
            const prevDate = new Date(lastContactDate + 'T00:00:00');
            if (dateToCheck < prevDate) return { isValid: false, message: `A data não pode ser anterior à última tentativa de contato (${lastContactDate}).` };
        }
    }

    return { isValid: true };
};

export const validateAbsenceChronology = (currentCycleActions, newActionData) => {
    const newMainDateStr = getActionMainDate(newActionData);
    if (!newMainDateStr) return { isValid: true };

    const newDateToCheck = new Date(newMainDateStr + 'T00:00:00');

    if (newActionData.actionType.startsWith('tentativa')) {
        if (newActionData.contactDate && newActionData.meetingDate) {
            if (newActionData.contactDate < newActionData.meetingDate) {
                return { isValid: false, message: `A data do contato (${formatDate(newActionData.contactDate)}) não pode ser anterior à data da convocação (${formatDate(newActionData.meetingDate)}).` };
            }
        }
    }

    const previousActions = currentCycleActions.filter(a => a.id !== newActionData.id);
    
    previousActions.sort((a, b) => {
        const dateA = getActionMainDate(a) || a.createdAt?.seconds || 0;
        const dateB = getActionMainDate(b) || b.createdAt?.seconds || 0;
        const timeA = typeof dateA === 'string' ? new Date(dateA+'T00:00:00Z').getTime() : (dateA instanceof Date ? dateA.getTime() : (dateA || 0) * 1000);
        const timeB = typeof dateB === 'string' ? new Date(dateB+'T00:00:00Z').getTime() : (dateB instanceof Date ? dateB.getTime() : (dateB || 0) * 1000);
        return timeA - timeB;
    });

    if (previousActions.length > 0) {
        const lastAction = previousActions[previousActions.length - 1];
        const lastDateStr = getActionMainDate(lastAction);
        
        if (lastDateStr) {
            const lastDate = new Date(lastDateStr + 'T00:00:00');
            if (newDateToCheck < lastDate) {
                return { 
                    isValid: false, 
                    message: `A data desta ação (${formatDate(newMainDateStr)}) não pode ser anterior à data da ação anterior: "${getActionTitle(lastAction.actionType)}" em ${formatDate(lastDateStr)}.`
                };
            }
        }
    }

    return { isValid: true };
};

const formatDate = (dateStr) => dateStr ? dateStr.split('-').reverse().join('/') : '';
const getActionTitle = (type) => {
    const titles = {
        'tentativa_1': '1ª Tentativa', 'tentativa_2': '2ª Tentativa', 'tentativa_3': '3ª Tentativa',
        'visita': 'Visita', 'encaminhamento_ct': 'Envio ao CT', 'analise': 'Análise'
    };
    return titles[type] || type;
};


// ==============================================================================
// --- Lógica de Reset ---
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