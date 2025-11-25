// =================================================================================
// ARQUIVO: logic.js
// VERSÃO: 3.0 (Ciclo de 3 Convocações e Botões de Ação Rápida)

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
                overallStatus: 'Aguardando 1ª Convocação'
            };
            groupedByIncident.set(groupId, incident);
        }
        
        incident.records.push(occ);

        if (!incident.participantsInvolved.has(occ.studentId)) {
            let student = state.students.find(s => s.matricula === occ.studentId);
            
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
    const { startDate, endDate, status, type } = state.filtersOccurrences;
    const studentSearchRaw = state.filterOccurrences || '';
    const studentSearch = studentSearchRaw.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    for (const [groupId, incident] of groupedByIncident.entries()) {
        const mainRecord = incident.records && incident.records.length > 0 ? incident.records[0] : null;
        if (!mainRecord) continue;

        const allResolved = incident.records.every(r => r.statusIndividual === 'Resolvido' || r.statusIndividual === 'Finalizado');
        incident.overallStatus = allResolved ? 'Finalizada' : 'Pendente';

        if (status !== 'all' && incident.overallStatus !== status) continue;
        if (type !== 'all' && mainRecord.occurrenceType !== type) continue;
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

// Mapa de Próxima Ação (Agendamento) baseado no Status
const occurrenceNextActionMap = {
    'Aguardando Convocação': 'agendar_convocacao_1', // Legado
    'Aguardando 1ª Convocação': 'agendar_convocacao_1',
    'Aguardando Comparecimento 1': null, // Ação deve ser via botão de Sim/Não, não "Avançar"
    'Aguardando 2ª Convocação': 'agendar_convocacao_2',
    'Aguardando Comparecimento 2': null,
    'Aguardando 3ª Convocação': 'agendar_convocacao_3',
    'Aguardando Comparecimento 3': null,
    'Aguardando Desfecho': 'desfecho_ou_ct', // Se falhou tudo
    'Aguardando Devolutiva CT': 'devolutiva_ct', 
    'Aguardando Parecer Final': 'parecer_final', 
    'Resolvido': null,
    'Finalizado': null
};

export const determineNextOccurrenceStep = (currentStatus) => {
    if (!currentStatus) return 'agendar_convocacao_1'; 
    return occurrenceNextActionMap[currentStatus] || null;
};

// Mapa para "Editar Ação" (descobrir qual modal abrir baseado no status atual)
// Nota: Para Comparecimento, a edição deve ser feita nos botões de ação ou "Editar Fato" se for Ação 1
export const determineCurrentActionFromStatus = (currentStatus) => {
    if (!currentStatus) return null;
    
    switch(currentStatus) {
        case 'Resolvido': 
        case 'Finalizado':
            return 'parecer_final';
        case 'Aguardando Parecer Final': return 'devolutiva_ct';
        case 'Aguardando Devolutiva CT': return 'desfecho_ou_ct';
        
        // Edição das Convocações (apenas se estiver aguardando comparecimento, edita o agendamento)
        case 'Aguardando Comparecimento 3': return 'agendar_convocacao_3';
        case 'Aguardando Comparecimento 2': return 'agendar_convocacao_2';
        case 'Aguardando Comparecimento 1': return 'agendar_convocacao_1';
        
        // Se estiver aguardando agendamento da próxima, quer dizer que a anterior falhou e foi registrada como "Não"
        case 'Aguardando 3ª Convocação': return 'resultado_convocacao_2'; // Edita o resultado da 2ª que foi "Não"
        case 'Aguardando 2ª Convocação': return 'resultado_convocacao_1'; // Edita o resultado da 1ª que foi "Não"
        case 'Aguardando Desfecho': return 'resultado_convocacao_3'; // Edita o resultado da 3ª que foi "Não"
        
        default: return null;
    }
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
    const occurrenceDate = record.date ? new Date(record.date + 'T00:00:00') : null;

    if (occurrenceDate && dateToCheck < occurrenceDate) {
        return { isValid: false, message: `A data não pode ser anterior à data da Ocorrência (${record.date}).` };
    }

    // Validação Cronológica das Convocações
    if (actionType === 'agendar_convocacao_2') {
        const prevDateStr = record.meetingDate;
        if (prevDateStr) {
            const prevDate = new Date(prevDateStr + 'T00:00:00');
            if (dateToCheck < prevDate) return { isValid: false, message: `A 2ª Convocação não pode ser anterior à 1ª Convocação (${prevDateStr}).` };
        }
    }
    
    if (actionType === 'agendar_convocacao_3') {
        const prevDateStr = record.meetingDate_2 || record.meetingDate;
        if (prevDateStr) {
            const prevDate = new Date(prevDateStr + 'T00:00:00');
            if (dateToCheck < prevDate) return { isValid: false, message: `A 3ª Convocação não pode ser anterior à convocação anterior (${prevDateStr}).` };
        }
    }

    if (actionType === 'desfecho_ou_ct' || actionType === 'devolutiva_ct') {
        const lastDate = record.meetingDate_3 || record.meetingDate_2 || record.meetingDate;
        if (lastDate) {
            const prevDate = new Date(lastDate + 'T00:00:00');
            if (dateToCheck < prevDate) return { isValid: false, message: `A data não pode ser anterior à última convocação (${lastDate}).` };
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

// Campos associados a cada etapa para limpeza
const camposAcao6 = ['parecerFinal'];
const camposAcao5 = ['ctFeedback', ...camposAcao6];
const camposAcao4_6 = ['oficioNumber', 'oficioYear', 'ctSentDate', 'desfechoChoice', ...camposAcao5]; 

// Convocação 3
const camposConv3_Result = ['contactSucceeded_3', 'contactType_3', 'contactDate_3', 'providenciasFamilia_3', ...camposAcao4_6];
const camposConv3_Schedule = ['meetingDate_3', 'meetingTime_3', ...camposConv3_Result];

// Convocação 2
const camposConv2_Result = ['contactSucceeded_2', 'contactType_2', 'contactDate_2', 'providenciasFamilia_2', ...camposConv3_Schedule];
const camposConv2_Schedule = ['meetingDate_2', 'meetingTime_2', ...camposConv2_Result];

// Convocação 1
const camposConv1_Result = ['contactSucceeded_1', 'contactType_1', 'contactDate_1', 'providenciasFamilia_1', ...camposConv2_Schedule];
const camposConv1_Schedule = ['meetingDate', 'meetingTime', ...camposConv1_Result];

export const occurrenceStepLogic = {
    'agendar_convocacao_1': { fieldsToClear: camposConv1_Schedule, statusAfterReset: 'Aguardando 1ª Convocação' },
    'resultado_convocacao_1': { fieldsToClear: camposConv1_Result, statusAfterReset: 'Aguardando Comparecimento 1' },
    
    'agendar_convocacao_2': { fieldsToClear: camposConv2_Schedule, statusAfterReset: 'Aguardando 2ª Convocação' },
    'resultado_convocacao_2': { fieldsToClear: camposConv2_Result, statusAfterReset: 'Aguardando Comparecimento 2' },
    
    'agendar_convocacao_3': { fieldsToClear: camposConv3_Schedule, statusAfterReset: 'Aguardando 3ª Convocação' },
    'resultado_convocacao_3': { fieldsToClear: camposConv3_Result, statusAfterReset: 'Aguardando Comparecimento 3' },

    'desfecho_ou_ct': { fieldsToClear: camposAcao4_6, statusAfterReset: 'Aguardando Desfecho' },
    'devolutiva_ct': { fieldsToClear: camposAcao5, statusAfterReset: 'Aguardando Devolutiva CT' },
    'parecer_final': { fieldsToClear: camposAcao6, statusAfterReset: 'Aguardando Parecer Final' }
};