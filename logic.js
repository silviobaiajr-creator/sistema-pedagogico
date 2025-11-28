
// =================================================================================
// ARQUIVO: logic.js
// VERSÃO: 3.4 (Atualizado para múltiplos prints no reset)

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
 * 
 * @param {Array} externalData - (Opcional) Se fornecido, usa esses dados em vez do state.occurrences
 * @param {Object} customFilters - (Opcional) Filtros específicos para sobrepor o estado global
 */
export const getFilteredOccurrences = (externalData = null, customFilters = null) => {
    const groupedByIncident = new Map();
    
    // Usa dados externos (para relatórios completos) ou o estado atual (para visualização rápida)
    const sourceData = externalData || state.occurrences;
    
    // Usa filtros passados ou os do estado global
    const filters = customFilters || state.filtersOccurrences;
    const studentSearchRaw = (customFilters ? '' : state.filterOccurrences) || ''; // Busca de texto só aplica na UI principal geralmente

    for (const occ of sourceData) {
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

        // Lógica resiliente para alunos não carregados (paginação)
        if (!incident.participantsInvolved.has(occ.studentId)) {
            // 1. Tenta encontrar na lista carregada (Memória)
            let student = state.students.find(s => s.matricula === occ.studentId);
            
            // 2. Se não achar, tenta usar os dados cacheados no próprio registro (Desnormalização)
            if (!student) {
                const participantData = occ.participants?.find(p => p.studentId === occ.studentId);
                const cachedName = participantData?.studentName || occ.studentName;
                const cachedClass = participantData?.studentClass || occ.studentClass;

                if (cachedName) {
                    student = {
                        matricula: occ.studentId,
                        name: cachedName,
                        class: cachedClass || '?',
                        isPlaceholder: true 
                    };
                } else if (state.selectedStudents && state.selectedStudents.has(occ.studentId)) {
                     student = state.selectedStudents.get(occ.studentId).student;
                } else {
                     student = {
                        matricula: occ.studentId,
                        name: `Aluno (${occ.studentId})`, 
                        class: '?',
                        isPlaceholder: true
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
    const { startDate, endDate, status, type } = filters;
    const studentSearch = studentSearchRaw.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    for (const [groupId, incident] of groupedByIncident.entries()) {
        const mainRecord = incident.records && incident.records.length > 0 ? incident.records[0] : null;
        if (!mainRecord) continue;

        const allResolved = incident.records.every(r => r.statusIndividual === 'Resolvido');
        incident.overallStatus = allResolved ? 'Finalizada' : 'Pendente';

        if (status && status !== 'all' && incident.overallStatus !== status) continue;
        if (type && type !== 'all' && mainRecord.occurrenceType !== type) continue;
        
        // Filtro de data rigoroso para relatórios
        if (startDate && mainRecord.date < startDate) continue;
        if (endDate && mainRecord.date > endDate) continue;

        if (studentSearch) {
            let hasMatchingStudent = false;
            for (const p of incident.participantsInvolved.values()) {
                const pName = p.student.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
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
// --- Lógica das Ocorrências (3 Convocações) ---
// ==============================================================================

// Mapeia o Status Atual para a PRÓXIMA AÇÃO necessária
const occurrenceNextActionMap = {
    'Aguardando Convocação 1': 'convocacao_1',
    'Aguardando Feedback 1': 'feedback_1', 
    'Aguardando Convocação 2': 'convocacao_2',
    'Aguardando Feedback 2': 'feedback_2',
    'Aguardando Convocação 3': 'convocacao_3',
    'Aguardando Feedback 3': 'feedback_3',
    'Aguardando Desfecho': 'desfecho_ou_ct', 
    'Aguardando Devolutiva CT': 'devolutiva_ct', 
    'Aguardando Parecer Final': 'parecer_final', 
    'Resolvido': null
};

export const determineNextOccurrenceStep = (currentStatus) => {
    // Se não tiver status, assume o início (1ª Convocação)
    if (!currentStatus || currentStatus === 'Aguardando Convocação') return 'convocacao_1';
    return occurrenceNextActionMap[currentStatus] || null;
};

// Mapeia o Status Atual para a AÇÃO QUE O GEROU (para edição)
const occurrencePreviousActionMap = {
    'Aguardando Convocação 1': null, 
    'Aguardando Feedback 1': 'convocacao_1', // Edita a Convocação 1
    'Aguardando Convocação 2': 'feedback_1', // Edita o Feedback da 1 (que falhou)
    'Aguardando Feedback 2': 'convocacao_2', // Edita a Convocação 2
    'Aguardando Convocação 3': 'feedback_2', // Edita o Feedback da 2
    'Aguardando Feedback 3': 'convocacao_3', // Edita a Convocação 3
    'Aguardando Desfecho': 'feedback_3',     // Edita o Feedback da 3 (Sucesso ou Falha->Desfecho)
    'Aguardando Devolutiva CT': 'desfecho_ou_ct', 
    'Aguardando Parecer Final': 'devolutiva_ct',
    'Resolvido': 'parecer_final'
};

export const determineCurrentActionFromStatus = (currentStatus) => {
    if (!currentStatus) return 'convocacao_1';
    if (currentStatus === 'Resolvido') return 'parecer_final';
    
    // Tratamento especial para status legados ou genéricos
    if (currentStatus === 'Aguardando Contato 1') return 'convocacao_1'; 
    if (currentStatus === 'Aguardando Contato 2') return 'convocacao_2';
    if (currentStatus === 'Aguardando Contato 3') return 'convocacao_3';

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

    // Nenhuma ação pode ser antes da ocorrência em si
    if (dateToCheck < occurrenceDate) {
        return { isValid: false, message: `A data não pode ser anterior à data da Ocorrência (${record.date}).` };
    }

    // Validação da Convocação 2 (Não pode ser antes da Convocação 1)
    if (actionType === 'convocacao_2') {
        if (record.meetingDate_1) {
            const prevDate = new Date(record.meetingDate_1 + 'T00:00:00');
            if (dateToCheck < prevDate) return { isValid: false, message: `A 2ª Convocação não pode ser anterior à 1ª (${record.meetingDate_1}).` };
        }
    }

    // Validação da Convocação 3 (Não pode ser antes da Convocação 2)
    if (actionType === 'convocacao_3') {
        const prevDateStr = record.meetingDate_2 || record.meetingDate_1;
        if (prevDateStr) {
            const prevDate = new Date(prevDateStr + 'T00:00:00');
            if (dateToCheck < prevDate) return { isValid: false, message: `A 3ª Convocação não pode ser anterior à anterior (${prevDateStr}).` };
        }
    }

    // Validação do Desfecho (Não pode ser antes da última convocação)
    if (actionType === 'desfecho_ou_ct') {
        const lastMeetingDate = record.meetingDate_3 || record.meetingDate_2 || record.meetingDate_1;
        if (lastMeetingDate) {
            const prevDate = new Date(lastMeetingDate + 'T00:00:00');
            if (dateToCheck < prevDate) return { isValid: false, message: `A data não pode ser anterior à última convocação (${lastMeetingDate}).` };
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
// --- Lógica de Reset (Limpar Ação) ---
// ==============================================================================

// Definição dos campos para cada etapa de Ocorrência (Reset Cascata Reverso)
const camposAcao6 = ['parecerFinal'];
const camposAcao5 = ['ctFeedback', ...camposAcao6];
const camposAcao4 = ['oficioNumber', 'oficioYear', 'ctSentDate', 'desfechoChoice', ...camposAcao5]; 

// Campos da Convocação 3 (e tudo que vem depois)
// ** ATUALIZADO: contactPrints_3
const camposFeedback3 = ['contactSucceeded_3', 'contactType_3', 'contactDate_3', 'contactPerson_3', 'providenciasFamilia_3', 'contactPrints_3', 'contactPrint_3', ...camposAcao4];
const camposConvocacao3 = ['meetingDate_3', 'meetingTime_3', ...camposFeedback3];

// Campos da Convocação 2 (e tudo que vem depois)
// ** ATUALIZADO: contactPrints_2
const camposFeedback2 = ['contactSucceeded_2', 'contactType_2', 'contactDate_2', 'contactPerson_2', 'providenciasFamilia_2', 'contactPrints_2', 'contactPrint_2', ...camposConvocacao3];
const camposConvocacao2 = ['meetingDate_2', 'meetingTime_2', ...camposFeedback2];

// Campos da Convocação 1 (e tudo que vem depois)
// ** ATUALIZADO: contactPrints_1
const camposFeedback1 = ['contactSucceeded_1', 'contactType_1', 'contactDate_1', 'contactPerson_1', 'providenciasFamilia_1', 'contactPrints_1', 'contactPrint_1', ...camposConvocacao2];
const camposConvocacao1 = ['meetingDate_1', 'meetingTime_1', ...camposFeedback1];

export const occurrenceStepLogic = {
    'convocacao_1': { fieldsToClear: camposConvocacao1, statusAfterReset: 'Aguardando Convocação 1' },
    'feedback_1':   { fieldsToClear: camposFeedback1,   statusAfterReset: 'Aguardando Feedback 1' },
    
    'convocacao_2': { fieldsToClear: camposConvocacao2, statusAfterReset: 'Aguardando Convocação 2' },
    'feedback_2':   { fieldsToClear: camposFeedback2,   statusAfterReset: 'Aguardando Feedback 2' },
    
    'convocacao_3': { fieldsToClear: camposConvocacao3, statusAfterReset: 'Aguardando Convocação 3' },
    'feedback_3':   { fieldsToClear: camposFeedback3,   statusAfterReset: 'Aguardando Feedback 3' },

    'desfecho_ou_ct': { fieldsToClear: camposAcao4, statusAfterReset: 'Aguardando Desfecho' },
    'devolutiva_ct':  { fieldsToClear: camposAcao5, statusAfterReset: 'Aguardando Devolutiva CT' },
    'parecer_final':  { fieldsToClear: camposAcao6, statusAfterReset: 'Aguardando Parecer Final' }
};
