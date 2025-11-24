// =================================================================================
// ARQUIVO: absence.js 
// VERSÃO: 4.0 (Padronização Visual Completa - Modal de Busca Ativa)
// =================================================================================

import { state, dom } from './state.js';
import { showToast, openModal, closeModal, formatDate, formatTime, getStatusBadge } from './utils.js';
import { getStudentProcessInfo, determineNextActionForStudent, validateAbsenceChronology } from './logic.js'; 
import { actionDisplayTitles, openFichaViewModal, generateAndShowConsolidatedFicha, generateAndShowOficio, openAbsenceHistoryModal, generateAndShowBuscaAtivaReport } from './reports.js';
import { updateRecordWithHistory, addRecordWithHistory, deleteRecord, getCollectionRef, searchStudentsByName, getStudentById } from './firestore.js'; 
import { doc, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from './firebase.js';


// --- Funções Auxiliares ---

const normalizeText = (text) => {
    if (!text) return '';
    return text.toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
};

const getActionMainDate = (action) => {
    if (!action) return null;
    switch (action.actionType) {
        case 'tentativa_1': case 'tentativa_2': case 'tentativa_3':
            return action.contactDate || action.meetingDate;
        case 'visita':
            return action.visitDate;
        case 'encaminhamento_ct':
            return action.ctSentDate;
        case 'analise':
             return action.createdAt?.toDate ? action.createdAt.toDate().toISOString().split('T')[0] : null;
        default:
            return null;
    }
};

const getDateInputForActionType = (actionType) => {
    switch (actionType) {
        case 'tentativa_1': case 'tentativa_2': case 'tentativa_3':
             return document.getElementById('contact-date') || document.getElementById('meeting-date');
        case 'visita':
            return document.getElementById('visit-date');
        case 'encaminhamento_ct':
            return document.getElementById('ct-sent-date');
        default:
            return null;
    }
};


// =================================================================================
// FUNÇÕES DE FLUXO DE BUSCA (REQUISIÇÃO 2)
// =================================================================================

let absenceSearchTimeout = null;

/**
 * Abre o modal para iniciar/continuar o fluxo de Busca Ativa.
 */
export const openAbsenceSearchFlowModal = () => {
    const input = document.getElementById('absence-search-flow-input');
    const suggestionsContainer = document.getElementById('absence-search-flow-suggestions');
    const resultsContainer = document.getElementById('absence-search-flow-results');

    input.value = '';
    suggestionsContainer.innerHTML = '';
    suggestionsContainer.classList.add('hidden');
    resultsContainer.innerHTML = '<p class="text-sm text-gray-400 text-center">Comece a digitar o nome do aluno acima.</p>';

    setupAbsenceSearchFlowAutocomplete(input, suggestionsContainer);
    
    // Anexa listeners de fecho ao modal de fluxo
    const closeBtn = document.getElementById('close-absence-search-flow-modal-btn');
    const cancelBtn = document.getElementById('cancel-absence-search-flow-btn');
    if (closeBtn) closeBtn.onclick = () => closeModal(dom.absenceSearchFlowModal);
    if (cancelBtn) cancelBtn.onclick = () => closeModal(dom.absenceSearchFlowModal);

    openModal(dom.absenceSearchFlowModal);
};

/**
 * Configura a lógica de busca de aluno dentro do modal de fluxo.
 */
const setupAbsenceSearchFlowAutocomplete = (input, suggestionsContainer) => {
    
    input.addEventListener('input', () => {
        const rawValue = input.value;
        suggestionsContainer.innerHTML = '';
        
        if (absenceSearchTimeout) clearTimeout(absenceSearchTimeout);
        
        if (!rawValue.trim()) {
            suggestionsContainer.classList.add('hidden');
            return;
        }

        absenceSearchTimeout = setTimeout(async () => {
            suggestionsContainer.classList.remove('hidden');
            suggestionsContainer.innerHTML = '<div class="p-2 text-gray-500 text-xs"><i class="fas fa-spinner fa-spin"></i> Buscando alunos...</div>';

            try {
                // (ATENÇÃO) Usa searchStudentsByName, que busca no servidor
                const results = await searchStudentsByName(rawValue);
                
                suggestionsContainer.innerHTML = ''; 
                
                if (results.length > 0) {
                    results.forEach(student => {
                        const item = document.createElement('div');
                        item.className = 'suggestion-item p-2 cursor-pointer hover:bg-emerald-50 border-b border-gray-100';
                        item.innerHTML = `<span class="font-semibold text-gray-800">${student.name}</span> <span class="text-xs text-gray-500">(${student.class || 'S/ Turma'})</span>`;
                        
                        item.addEventListener('click', () => {
                            // 1. Cache Imediato
                            if (!state.students.find(s => s.matricula === student.matricula)) {
                                state.students.push(student);
                            }

                            // 2. Inicia/Continua Ação
                            handleNewAbsenceAction(student); 
                            
                            // 3. Fecha o modal de busca
                            closeModal(dom.absenceSearchFlowModal); 
                            
                            // 4. Limpa a busca de filtro principal
                            dom.searchAbsences.value = ''; 
                            state.filterAbsences = '';
                            renderAbsences();
                            suggestionsContainer.classList.add('hidden');
                        });
                        suggestionsContainer.appendChild(item);
                    });
                } else {
                    suggestionsContainer.innerHTML = '<div class="p-2 text-gray-500 text-xs">Nenhum aluno encontrado.</div>';
                }
            } catch (error) {
                console.error("Erro no autocomplete:", error);
                suggestionsContainer.innerHTML = '<div class="p-2 text-red-500 text-xs">Erro na busca.</div>';
            }
        }, 400); 
    });

    document.addEventListener('click', (e) => {
        if (!suggestionsContainer.contains(e.target) && e.target !== input) {
            suggestionsContainer.classList.add('hidden');
        }
    });
};


// =================================================================================
// RENDERIZAÇÃO (Render Absences)
// =================================================================================

export const renderAbsences = () => {
    dom.loadingAbsences.classList.add('hidden');
    const filterTerm = normalizeText(state.filterAbsences);

    const searchFiltered = state.absences.filter(a => {
        if (!filterTerm) return true;
        const nameToCheck = a.studentName ? normalizeText(a.studentName) : '';
        if (nameToCheck && nameToCheck.includes(filterTerm)) return true;
        const student = state.students.find(s => s.matricula === a.studentId);
        if (student && normalizeText(student.name).includes(filterTerm)) return true;
        return false;
    });

    const groupedByProcess = searchFiltered.reduce((acc, action) => {
        const key = action.processId || `no-proc-${action.id}`;
        if (!acc[key]) acc[key] = [];
        acc[key].push(action);
        return acc;
    }, {});

    const filteredGroupKeys = Object.keys(groupedByProcess).filter(processId => {
        const actions = groupedByProcess[processId];
        if (!actions || actions.length === 0) return false;
        
        actions.sort((a, b) => {
            const dateA = getActionMainDate(a) || a.createdAt?.seconds || 0;
            const dateB = getActionMainDate(b) || b.createdAt?.seconds || 0;
            const timeA = typeof dateA === 'string' ? new Date(dateA+'T00:00:00Z').getTime() : (dateA instanceof Date ? dateA.getTime() : (dateA || 0) * 1000);
            const timeB = typeof dateB === 'string' ? new Date(dateB+'T00:00:00Z').getTime() : (dateB instanceof Date ? dateB.getTime() : (dateB || 0) * 1000);
            if (timeA === timeB) {
                const createA = a.createdAt?.seconds || (a.createdAt instanceof Date ? a.createdAt.getTime() / 1000 : 0);
                const createB = b.createdAt?.seconds || (b.createdAt instanceof Date ? b.createdAt.getTime() / 1000 : 0);
                return (createA || 0) - (createB || 0);
            }
            return (timeA || 0) - (timeB || 0); 
        });

        const { startDate, endDate, processStatus, pendingAction, returnStatus } = state.filtersAbsences;
        const firstAction = actions[0];
        const processStartDateRaw = getActionMainDate(firstAction) || firstAction.createdAt;
        let processStartDate;
        if (processStartDateRaw instanceof Date) {
            processStartDate = processStartDateRaw;
        } else if (typeof processStartDateRaw === 'string') {
             try { processStartDate = new Date(processStartDateRaw + 'T00:00:00Z'); } catch { processStartDate = new Date(0); } 
        } else if (processStartDateRaw?.seconds) {
             processStartDate = new Date(processStartDateRaw.seconds * 1000);
        } else {
             processStartDate = new Date(0); 
        }

        if (startDate) {
            const filterStartDate = new Date(startDate + 'T00:00:00Z'); 
            if (processStartDate < filterStartDate) return false;
        }
        if (endDate) {
            const filterEndDate = new Date(endDate + 'T23:59:59Z'); 
            if (processStartDate > filterEndDate) return false;
        }

        const isConcluded = actions.some(a => a.actionType === 'analise');
        if (processStatus === 'in_progress' && isConcluded) return false;
        if (processStatus === 'concluded' && !isConcluded) return false;

        const lastAction = actions[actions.length - 1]; 
        if (pendingAction !== 'all') {
            if (isConcluded) return false; 

            let isCurrentlyPendingContact =
                (lastAction.actionType.startsWith('tentativa') && lastAction.contactSucceeded == null) ||
                (lastAction.actionType === 'visita' && lastAction.visitSucceeded == null);

            let isCurrentlyPendingFeedback = false;
            const ctAction = actions.find(a => a.actionType === 'encaminhamento_ct');
            if (ctAction && !isConcluded) {
                isCurrentlyPendingFeedback = ctAction.ctFeedback == null;
            }

            if (pendingAction === 'pending_contact' && !isCurrentlyPendingContact) return false;
            if (pendingAction === 'pending_feedback' && !isCurrentlyPendingFeedback) return false;
        }

        if (returnStatus !== 'all') {
             const lastActionWithReturnInfo = [...actions].reverse().find(a =>
                a.contactReturned === 'yes' || a.contactReturned === 'no' ||
                a.visitReturned === 'yes' || a.visitReturned === 'no' ||
                a.ctReturned === 'yes' || a.ctReturned === 'no'
             );

             if (lastActionWithReturnInfo) {
                 const lastDefinitiveStatus = lastActionWithReturnInfo.contactReturned || lastActionWithReturnInfo.visitReturned || lastActionWithReturnInfo.ctReturned;
                 if (returnStatus === 'returned' && lastDefinitiveStatus !== 'yes') return false;
                 if (returnStatus === 'not_returned' && lastDefinitiveStatus !== 'no') return false;
                 if (returnStatus === 'pending') return false; 
             } else {
                 if (returnStatus === 'returned' || returnStatus === 'not_returned') return false; 
             }
        }
        return true;
    });

    if (filteredGroupKeys.length === 0) {
        const hasActiveFilters = state.filterAbsences !== '' ||
                                 state.filtersAbsences.processStatus !== 'all' ||
                                 state.filtersAbsences.pendingAction !== 'all' ||
                                 state.filtersAbsences.returnStatus !== 'all' ||
                                 state.filtersAbsences.startDate ||
                                 state.filtersAbsences.endDate;
        
        if (hasActiveFilters) {
            dom.emptyStateAbsences.classList.remove('hidden');
            dom.emptyStateAbsences.querySelector('h3').textContent = 'Nenhum processo encontrado';
            dom.emptyStateAbsences.querySelector('p').textContent = 'Tente ajustar os seus filtros de busca.';
        } else {
            dom.emptyStateAbsences.classList.remove('hidden');
            dom.emptyStateAbsences.querySelector('h3').textContent = 'Nenhuma ação registada';
            dom.emptyStateAbsences.querySelector('p').textContent = 'Use o botão "Nova Ação" para começar.'; 
        }
        dom.absencesListDiv.innerHTML = ''; 
    } else {
        dom.emptyStateAbsences.classList.add('hidden');

        const sortedGroupKeys = filteredGroupKeys.sort((a, b) => {
            const actionsA = groupedByProcess[a];
            const actionsB = groupedByProcess[b];
            const lastActionA = actionsA?.length > 0 ? actionsA[actionsA.length - 1] : null;
            const lastActionB = actionsB?.length > 0 ? actionsB[actionsB.length - 1] : null;

            const timeA = getActionMainDate(lastActionA) || lastActionA?.createdAt;
            const timeB = getActionMainDate(lastActionB) || lastActionB?.createdAt;

            const timestampA = timeA instanceof Date ? timeA.getTime() : (typeof timeA === 'string' ? new Date(timeA+'T00:00:00Z').getTime() : (timeA?.seconds || 0) * 1000);
            const timestampB = timeB instanceof Date ? timeB.getTime() : (typeof timeB === 'string' ? new Date(timeB+'T00:00:00Z').getTime() : (timeB?.seconds || 0) * 1000);

            return (timestampB || 0) - (timestampA || 0); 
        });

        let html = '';
        for (const processId of sortedGroupKeys) {
            const actions = groupedByProcess[processId];
            if (!actions || actions.length === 0) continue;

            const firstAction = actions[0];
            const lastProcessAction = actions[actions.length - 1]; 
            const student = state.students.find(s => s.matricula === firstAction.studentId);
            
            const studentName = firstAction.studentName || (student ? student.name : `Aluno (${firstAction.studentId})`);
            const studentClass = firstAction.studentClass || (student ? student.class : 'N/A');

            const isConcluded = actions.some(a => a.actionType === 'analise');
            
            let historyHtml = '';
            actions.forEach(abs => {
                const actionDisplayDate = getActionMainDate(abs) || (abs.createdAt?.toDate() ? abs.createdAt.toDate().toISOString().split('T')[0] : '');

                const returned = abs.contactReturned === 'yes' || abs.visitReturned === 'yes' || abs.ctReturned === 'yes';
                const notReturned = abs.contactReturned === 'no' || abs.visitReturned === 'no' || abs.ctReturned === 'no';
                
                let statusHtml = '';
                if (abs.actionType.startsWith('tentativa')) {
                    if (abs.contactSucceeded === 'yes') {
                        statusHtml = `<span class="text-xs text-green-600 font-semibold">(<i class="fas fa-check"></i> Contato Realizado)</span>`;
                    } else if (abs.contactSucceeded === 'no') {
                        statusHtml = `<span class="text-xs text-red-600 font-semibold">(<i class="fas fa-times"></i> Contato Não Realizado)</span>`;
                    } else if (abs.meetingDate) { 
                        statusHtml = `<span class="text-xs text-yellow-600 font-semibold">(<i class="fas fa-hourglass-half"></i> Aguardando Contato)</span>`;
                    } else { 
                        statusHtml = `<span class="text-xs text-blue-600 font-semibold">(<i class="fas fa-hourglass-start"></i> Aguardando Convocação)</span>`;
                    }
                } else if (abs.actionType === 'visita') {
                     if (abs.visitSucceeded === 'yes') {
                        statusHtml = `<span class="text-xs text-green-600 font-semibold">(<i class="fas fa-check"></i> Contato Realizado)</span>`;
                    } else if (abs.visitSucceeded === 'no') {
                        statusHtml = `<span class="text-xs text-red-600 font-semibold">(<i class="fas fa-times"></i> Contato Não Realizado)</span>`;
                    } else {
                        statusHtml = `<span class="text-xs text-yellow-600 font-semibold">(<i class="fas fa-hourglass-half"></i> Aguardando Contato)</span>`;
                    }
                } else if (abs.actionType === 'encaminhamento_ct') {
                    if (abs.ctFeedback) {
                        statusHtml = `<span class="text-xs text-green-600 font-semibold">(<i class="fas fa-inbox"></i> Devolutiva Recebida)</span>`;
                    } else if (abs.ctSentDate) {
                        statusHtml = `<span class="text-xs text-yellow-600 font-semibold">(<i class="fas fa-hourglass-half"></i> Aguardando Devolutiva)</span>`;
                    } else {
                         statusHtml = `<span class="text-xs text-blue-600 font-semibold">(<i class="fas fa-hourglass-start"></i> Aguardando Envio)</span>`;
                    }
                }

                let viewButtonHtml = '';
                if (abs.actionType.startsWith('tentativa') && abs.meetingDate && abs.meetingTime) {
                    viewButtonHtml = `
                        <button type="button" class="view-notification-btn-hist text-sky-600 hover:text-sky-900 text-xs font-semibold ml-2 cursor-pointer" data-id="${abs.id}" title="Ver Notificação">
                            [<i class="fas fa-eye fa-fw"></i> Ver Notificação]
                        </button>`; 
                }
                if (abs.actionType === 'encaminhamento_ct' && abs.oficioNumber) {
                     viewButtonHtml = `
                        <button type="button" class="view-oficio-btn-hist text-green-600 hover:text-green-900 text-xs font-semibold ml-2 cursor-pointer" data-id="${abs.id}" title="Ver Ofício ${abs.oficioNumber}/${abs.oficioYear || ''}">
                            [<i class="fas fa-eye fa-fw"></i> Ver Ofício]
                        </button>`;
                }

                historyHtml += `
                    <p class="text-xs text-gray-600 flex items-center flex-wrap">
                        <span>
                            <i class="fas fa-check text-green-500 fa-fw mr-1"></i>
                            <strong>${actionDisplayTitles[abs.actionType] || 'N/A'}</strong> (Data: ${formatDate(actionDisplayDate)}) ${statusHtml}
                            ${returned ? '<span class="text-xs text-green-600 font-semibold ml-1">[<i class="fas fa-check-circle"></i> Retornou]</span>' : ''}
                            ${notReturned ? '<span class="text-xs text-red-600 font-semibold ml-1">[<i class="fas fa-times-circle"></i> Não Retornou]</span>' : ''}
                        </span>
                        ${viewButtonHtml}
                    </p>
                `;
            });
            
            const disableEditDelete = isConcluded || !lastProcessAction;
            const disableReason = isConcluded ? "Processo concluído" : "Apenas a última ação pode ser alterada";

            const avancarBtn = `
                <button type="button"
                        class="avancar-etapa-btn text-sky-600 hover:text-sky-900 text-xs font-semibold py-1 px-2 rounded-md bg-sky-50 hover:bg-sky-100 ${isConcluded ? 'opacity-50 cursor-not-allowed' : ''}"
                        title="${isConcluded ? 'Processo concluído' : 'Avançar para a próxima etapa'}"
                        ${isConcluded ? 'disabled' : ''}
                        data-student-id="${firstAction.studentId}">
                    <i class="fas fa-plus"></i> Avançar Etapa
                </button>
            `; 
            
            const editBtn = `
                <button type="button"
                        class="edit-absence-action-btn text-yellow-600 hover:text-yellow-900 text-xs font-semibold py-1 px-2 rounded-md bg-yellow-50 hover:bg-yellow-100 ${disableEditDelete ? 'opacity-50 cursor-not-allowed' : ''}"
                        title="${disableReason}"
                        ${disableEditDelete ? 'disabled' : ''}
                        data-id="${lastProcessAction.id}">
                    <i class="fas fa-pencil-alt"></i> Editar Ação
                </button>
            `;

            const limparBtn = `
                <button type="button"
                        class="reset-absence-action-btn text-red-600 hover:text-red-900 text-xs font-semibold py-1 px-2 rounded-md bg-red-50 hover:bg-red-100 ${disableEditDelete ? 'opacity-50 cursor-not-allowed' : ''}"
                        title="${disableReason}"
                        ${disableEditDelete ? 'disabled' : ''}
                        data-id="${lastProcessAction.id}">
                    <i class="fas fa-undo-alt"></i> Limpar Ação
                </button>
            `;

            const contentId = `ba-content-${processId}`;
            html += `
                <div class="border rounded-lg mb-4 bg-white shadow">
                    <div class="process-header bg-gray-50 hover:bg-gray-100 cursor-pointer p-4 flex justify-between items-center"
                         data-content-id="${contentId}">
                        <div>
                            <p class="font-semibold text-gray-800">${studentName}</p>
                            <p class="text-sm text-gray-500">Turma: ${studentClass} | Início: ${formatDate(firstAction.createdAt?.toDate())}</p>
                        </div>
                        <div class="flex items-center space-x-4">
                            ${isConcluded ? '<span class="text-xs font-bold text-white bg-green-600 px-2 py-1 rounded-full">CONCLUÍDO</span>' : '<span class="text-xs font-bold text-white bg-yellow-600 px-2 py-1 rounded-full">EM ANDAMENTO</span>'}
                            <button class="generate-ficha-btn-row bg-teal-600 text-white font-bold py-1 px-3 rounded-lg shadow-md hover:bg-teal-700 text-xs no-print" data-student-id="${firstAction.studentId}" data-process-id="${processId}">
                                <i class="fas fa-file-invoice"></i> Ficha
                            </button>
                            <i class="fas fa-chevron-down transition-transform duration-300"></i>
                        </div>
                    </div>
                    
                    <div class="process-content" id="${contentId}" style="max-height: 0px; overflow: hidden;">
                        <div class="p-4 border-t border-gray-200">
                             <h5 class="text-xs font-bold uppercase text-gray-500 mb-2">Histórico Individual</h5>
                             <div class="space-y-1 mb-3">
                                ${historyHtml}
                             </div>
                             <h5 class="text-xs font-bold uppercase text-gray-500 mb-2">Ações</h5>
                             <div class="flex items-center flex-wrap gap-2">
                                ${avancarBtn}
                                ${editBtn}
                                ${limparBtn}
                             </div>
                        </div>
                    </div>
                </div>
            `;
        } 
        dom.absencesListDiv.innerHTML = html; 
    }
};


/**
 * Lógica para determinar a próxima ação de busca ativa.
 */
export const handleNewAbsenceAction = (student) => {
    const { currentCycleActions } = getStudentProcessInfo(student.matricula);
    currentCycleActions.sort((a, b) => { 
        const dateA = getActionMainDate(a) || a.createdAt?.seconds || 0;
        const dateB = getActionMainDate(b) || b.createdAt?.seconds || 0;
        const timeA = typeof dateA === 'string' ? new Date(dateA+'T00:00:00Z').getTime() : (dateA instanceof Date ? dateA.getTime() : (dateA || 0) * 1000);
        const timeB = typeof dateB === 'string' ? new Date(dateB+'T00:00:00Z').getTime() : (dateB instanceof Date ? dateB.getTime() : (dateB || 0) * 1000);
         if (timeA === timeB) {
            const createA = a.createdAt?.seconds || (a.createdAt instanceof Date ? a.createdAt.getTime() / 1000 : 0);
            const createB = b.createdAt?.seconds || (b.createdAt instanceof Date ? b.createdAt.getTime() / 1000 : 0);
            return (createA || 0) - (createB || 0);
        }
        return (timeA || 0) - (timeB || 0);
    });

    if (currentCycleActions.length > 0) {
        const lastAction = currentCycleActions[currentCycleActions.length - 1];
        let isPending = false;
        let pendingActionMessage = "Complete a etapa anterior para poder prosseguir.";

        if (lastAction.actionType.startsWith('tentativa')) {
            // Verifica a convocação (Ação 1/2)
            if (lastAction.meetingDate == null) {
                isPending = true;
                pendingActionMessage = "Registre a Data/Hora da Convocação para esta tentativa (Ação 1/2).";
            }
            // Verifica o contato (Ação 3)
            else if (lastAction.contactSucceeded == null) { 
                isPending = true;
                pendingActionMessage = "Registre se houve sucesso no contato da última tentativa (Ação 3).";
            } 
            // Verifica o retorno
            else if (lastAction.contactReturned == null && lastAction.contactSucceeded === 'yes') { 
                isPending = true;
                pendingActionMessage = "Registre se o aluno retornou após o contato.";
            }
        } else if (lastAction.actionType === 'visita') {
            if (lastAction.visitSucceeded == null) { 
                isPending = true;
                pendingActionMessage = "Registre se houve sucesso no contato da visita.";
            } else if (lastAction.visitReturned == null) { 
                isPending = true;
                pendingActionMessage = "Registre se o aluno retornou após a visita.";
            }
        } else if (lastAction.actionType === 'encaminhamento_ct') {
             if (lastAction.ctSentDate == null) {
                 isPending = true;
                 pendingActionMessage = "Registre a Data, Nº e Ano do Ofício de envio ao CT.";
             }
            else if (lastAction.ctFeedback == null) { 
                isPending = true;
                pendingActionMessage = "Registre a devolutiva recebida do Conselho Tutelar.";
            } else if (lastAction.ctReturned == null) { 
                isPending = true;
                pendingActionMessage = "Registre se o aluno retornou após a ação do CT.";
            }
        }

        if (isPending) {
            showToast(pendingActionMessage);
            // (CORREÇÃO CRÍTICA) Passamos a 'lastAction' como o objeto 'data' para edição
            // Isso força o modal a abrir no modo de "edição" da ação pendente.
            openAbsenceModalForStudent(student, lastAction.actionType, lastAction); 
            return;
        }
    }
    const nextActionType = determineNextActionForStudent(student.matricula);
    if (nextActionType) {
        openAbsenceModalForStudent(student, nextActionType); 
    } else {
        showToast("Processo já concluído ou em etapa final."); 
    }
};


/**
 * Ativa/Desativa campos de detalhe de contato (Família).
 */
export const toggleFamilyContactFields = (enable, fieldsContainer) => {
    if (!fieldsContainer) return;
    fieldsContainer.classList.toggle('hidden', !enable);
    const detailFields = fieldsContainer.querySelectorAll('input[type="date"], input[type="text"], textarea, select');
    // Adiciona/remove 'required' apenas se a seção estiver visível/habilitada
    const returnedRadioGroup = document.querySelectorAll('input[name="contact-returned"]');

    detailFields.forEach(input => {
        input.disabled = !enable;
        input.required = enable; 
        if (!enable) {
            input.classList.add('bg-gray-200', 'cursor-not-allowed');
            input.value = ''; // Limpa se desabilitado
        } else {
            input.classList.remove('bg-gray-200', 'cursor-not-allowed');
        }
    });
    
    // Aluno retornou só é obrigatório se conseguiu contato
    returnedRadioGroup.forEach(radio => radio.required = enable);
};

/**
 * Ativa/Desativa campos de detalhe de contato (Visita).
 */
export const toggleVisitContactFields = (enable, fieldsContainer) => {
     if (!fieldsContainer) return;
     fieldsContainer.classList.toggle('hidden', !enable);
     const detailFields = fieldsContainer.querySelectorAll('input[type="text"], textarea');
     const returnedRadioGroup = document.querySelectorAll('input[name="visit-returned"]');
     
     detailFields.forEach(input => {
        input.disabled = !enable;
        input.required = enable; 
        if (!enable) {
            input.classList.add('bg-gray-200', 'cursor-not-allowed');
            input.value = ''; // Limpa se desabilitado
        } else {
            input.classList.remove('bg-gray-200', 'cursor-not-allowed');
        }
    });
    // Aluno retornou só é obrigatório se conseguiu contato
    returnedRadioGroup.forEach(radio => radio.required = enable);
};

/**
 * Abre e popula o modal de registro/edição de uma ação de Busca Ativa.
 * (REQUISIÇÃO 1: Padronização de Modais e Ocultação de Campos Antigos)
 */
export const openAbsenceModalForStudent = (student, forceActionType = null, data = null) => {
    dom.absenceForm.reset();
    ['meeting-date', 'contact-date', 'visit-date', 'ct-sent-date'].forEach(id => { 
        const input = document.getElementById(id);
        if (input) input.removeAttribute('min');
    });
    // Desativa todos os campos 'required' e reativa apenas os da etapa atual
    dom.absenceForm.querySelectorAll('[required]').forEach(el => el.required = false);
    
    // Esconde todos os grupos dinâmicos e fieldsets de dados de aluno/faltas
    document.querySelectorAll('.dynamic-field-group').forEach(group => group.classList.add('hidden'));
    
    // === (NOVO) Padronização Visual: Status Display ===
    const statusDisplay = document.getElementById('absence-status-display');
    const finalActionType = forceActionType || (data ? data.actionType : determineNextActionForStudent(student.matricula));
    
    // Determina o texto do status visual
    let statusText = 'Em Andamento';
    let statusColor = 'bg-blue-100 text-blue-800';

    if (finalActionType === 'analise') {
        statusText = 'Aguardando Análise BAE';
        statusColor = 'bg-purple-100 text-purple-800';
    } else if (finalActionType.startsWith('tentativa')) {
        statusText = `Tentativa ${finalActionType.split('_')[1]}`;
    } else if (finalActionType === 'encaminhamento_ct') {
        statusText = 'Encaminhamento CT';
    } else if (finalActionType === 'visita') {
        statusText = 'Visita Domiciliar';
    }

    if (statusDisplay) {
        statusDisplay.innerHTML = `<strong>Etapa:</strong> <span class="text-xs font-medium px-2.5 py-0.5 rounded-full ${statusColor} ml-2">${statusText}</span>`;
    }

    const absenceStudentInfo = document.getElementById('absence-student-info'); // Não usamos mais este ID no novo HTML, mas mantemos a lógica para os hiddens
    const absencePeriodData = document.getElementById('absence-period-data');

    const isEditing = !!data;
    document.getElementById('absence-modal-title').innerText = isEditing ? 'Editar Ação de Busca Ativa' : 'Acompanhamento Busca Ativa';
    document.getElementById('absence-id').value = isEditing ? data.id : '';

    // (CORREÇÃO) Armazena o ID do aluno selecionado no dataset do formulário para validação segura
    dom.absenceForm.dataset.selectedStudentId = student.matricula;

    // 1. Popula dados (Visíveis e Ocultos)
    document.getElementById('absence-student-name').value = student.name || '';
    // Campos ocultos:
    document.getElementById('absence-student-class').value = student.class || '';
    document.getElementById('absence-student-endereco').value = student.endereco || '';
    document.getElementById('absence-student-contato').value = student.contato || '';
    
    const { processId, currentCycleActions } = getStudentProcessInfo(student.matricula);
    currentCycleActions.sort((a, b) => { 
        const dateA = getActionMainDate(a) || a.createdAt?.seconds || 0;
        const dateB = getActionMainDate(b) || b.createdAt?.seconds || 0;
        const timeA = typeof dateA === 'string' ? new Date(dateA+'T00:00:00Z').getTime() : (dateA instanceof Date ? dateA.getTime() : (dateA || 0) * 1000);
        const timeB = typeof dateB === 'string' ? new Date(dateB+'T00:00:00Z').getTime() : (dateB instanceof Date ? dateB.getTime() : (dateB || 0) * 1000);
         if (timeA === timeB) {
            const createA = a.createdAt?.seconds || (a.createdAt instanceof Date ? a.createdAt.getTime() / 1000 : 0);
            const createB = b.createdAt?.seconds || (b.createdAt instanceof Date ? b.createdAt.getTime() / 1000 : 0);
            return (createA || 0) - (createB || 0);
        }
        return (timeA || 0) - (timeB || 0);
    });

    document.getElementById('absence-process-id').value = data?.processId || processId;

    document.getElementById('action-type').value = finalActionType;
    document.getElementById('action-type-display').value = actionDisplayTitles[finalActionType] || '';
    
    // 2. Configura a visibilidade e editabilidade dos dados de Faltas
    const firstAbsenceRecordInCycle = currentCycleActions.find(a => a.periodoFaltasStart);
    const isFirstStep = finalActionType === 'tentativa_1';
    const isAbsenceDataEditable = isFirstStep && !firstAbsenceRecordInCycle; 
    
    // Mostra o fieldset de faltas APENAS se for a 1ª etapa ou se já tiver dados preenchidos para visualização
    if (isFirstStep || firstAbsenceRecordInCycle) {
        absencePeriodData.classList.remove('hidden');
    } else {
        absencePeriodData.classList.add('hidden');
    }

    const absenceInputs = absencePeriodData.querySelectorAll('input');
    
    // Só exige os campos de falta se estiverem visíveis e editáveis
    const shouldRequireAbsenceData = isAbsenceDataEditable && !absencePeriodData.classList.contains('hidden');
    document.getElementById('absence-start-date').required = shouldRequireAbsenceData;
    document.getElementById('absence-end-date').required = shouldRequireAbsenceData;
    document.getElementById('absence-count').required = shouldRequireAbsenceData;

    if (isAbsenceDataEditable) {
        // Se é a primeira tentativa (nova) OU estamos editando a primeira tentativa
        absenceInputs.forEach(input => { input.readOnly = false; input.classList.remove('bg-gray-100'); });
    } else {
        // Se não é a primeira tentativa, preenche com os dados existentes e torna só leitura
        const sourceData = isEditing && data.actionType === 'tentativa_1' ? data : firstAbsenceRecordInCycle;

        document.getElementById('absence-start-date').value = sourceData?.periodoFaltasStart || '';
        document.getElementById('absence-end-date').value = sourceData?.periodoFaltasEnd || '';
        document.getElementById('absence-count').value = sourceData?.absenceCount || '';
        
        absenceInputs.forEach(input => { input.readOnly = true; input.classList.add('bg-gray-100'); });
    }

    // 3. Configura a seção específica da Ação
    const groupElement = document.getElementById(finalActionType.startsWith('tentativa') ? 'group-tentativas' : `group-${finalActionType}`);
    if (groupElement) groupElement.classList.remove('hidden');

    // Configuração de campos obrigatórios e estado
    switch (finalActionType) {
        case 'tentativa_1': case 'tentativa_2': case 'tentativa_3':
            const convocationSection = document.getElementById('convocation-section');
            const familyContactSection = document.getElementById('family-contact-section');
            
            // Regra: Se não há data/hora de convocação, forçamos a Ação 1/2
            const hasConvocation = !!(data?.meetingDate);
            const isContactStep = isEditing && hasConvocation && data.contactSucceeded == null;

            if (isEditing && isContactStep) {
                 // Edição de contato (Ação 3)
                convocationSection.classList.add('hidden');
                familyContactSection.classList.remove('hidden');
                document.querySelectorAll('input[name="contact-succeeded"]').forEach(r => r.required = true);
                document.querySelectorAll('input[name="contact-returned"]').forEach(r => r.required = true);

            } else if (isEditing && hasConvocation) {
                 // Edição de uma ação já completa (Ação 3 ou Analise)
                 convocationSection.classList.add('hidden');
                 familyContactSection.classList.remove('hidden');
                 document.querySelectorAll('input[name="contact-succeeded"]').forEach(r => r.required = true);
                 document.querySelectorAll('input[name="contact-returned"]').forEach(r => r.required = true);

            } else if (hasConvocation && !isEditing) {
                // Nova Ação (Avançar Etapa) -> Ir direto para o Contato
                 convocationSection.classList.add('hidden');
                 familyContactSection.classList.remove('hidden');
                 document.querySelectorAll('input[name="contact-succeeded"]').forEach(r => r.required = true);
                 document.querySelectorAll('input[name="contact-returned"]').forEach(r => r.required = true);

            } else {
                 // Nova Ação (Primeira Etapa) OU Edição de Convocação (Ação 1/2)
                convocationSection.classList.remove('hidden');
                familyContactSection.classList.add('hidden');
                document.getElementById('meeting-date').required = true;
                document.getElementById('meeting-time').required = true;
            }
            break;
        case 'visita':
            document.getElementById('visit-agent').required = true;
            document.getElementById('visit-date').required = true;
            document.querySelectorAll('input[name="visit-succeeded"]').forEach(r => r.required = true);
            document.querySelectorAll('input[name="visit-returned"]').forEach(r => r.required = true);
            break;
        case 'encaminhamento_ct':
            // (CORREÇÃO) Seleção robusta dos fieldsets
            const ctGroup = document.getElementById('group-encaminhamento_ct');
            const fieldsets = ctGroup ? ctGroup.querySelectorAll('fieldset') : [];
            const ctSendSection = fieldsets.length > 0 ? fieldsets[0] : null;
            const ctFeedbackSection = fieldsets.length > 1 ? fieldsets[1] : null;

            if (!ctSendSection || !ctFeedbackSection) {
                console.error("ERRO CRÍTICO: Fieldsets de CT não encontrados.");
                showToast("Erro de estrutura HTML no modal de CT.");
                return;
            }
            
            const hasSentCT = !!(data?.ctSentDate);

            // Regra: Se estamos editando E já temos data de envio, mostramos a devolutiva.
            // Se estamos editando mas NÃO temos data de envio (erro de dados), mostramos envio.
            // Se é nova ação, mostramos envio.
            
            if (isEditing && hasSentCT) {
                 // Edição de Devolutiva (após o envio)
                ctSendSection.classList.add('hidden');
                ctFeedbackSection.classList.remove('hidden');
                document.getElementById('ct-feedback').required = true;
                document.querySelectorAll('input[name="ct-returned"]').forEach(r => r.required = true);
                
                document.getElementById('ct-sent-date').required = false;
                document.getElementById('oficio-number').required = false;
                document.getElementById('oficio-year').required = false;

            } else {
                // Nova Ação OU Edição de Envio (ainda não enviou ou corrigindo envio)
                ctSendSection.classList.remove('hidden');
                ctFeedbackSection.classList.add('hidden');
                document.getElementById('ct-sent-date').required = true;
                document.getElementById('oficio-number').required = true;
                document.getElementById('oficio-year').required = true;
                if(!isEditing) { 
                    document.getElementById('oficio-year').value = new Date().getFullYear();
                }
                
                document.getElementById('ct-feedback').required = false;
                document.querySelectorAll('input[name="ct-returned"]').forEach(r => r.required = false);
            }
            break;
        case 'analise':
            document.getElementById('ct-parecer').required = true;
            break;
    }

    // --- Define a Data Mínima (CONSISTÊNCIA) ---
    let previousAction = null;
    if (isEditing) {
        const currentIndex = currentCycleActions.findIndex(a => a.id === data.id);
        if (currentIndex > 0) previousAction = currentCycleActions[currentIndex - 1];
    } else if (currentCycleActions.length > 0) {
        previousAction = currentCycleActions[currentCycleActions.length - 1];
    }

    if (previousAction) {
        const previousDateString = getActionMainDate(previousAction);
        if (previousDateString) {
            try {
                const previousDate = new Date(previousDateString + 'T00:00:00Z'); 
                previousDate.setUTCDate(previousDate.getUTCDate() + 1); 
                const minDateString = previousDate.toISOString().split('T')[0];

                const currentActionDateInput = getDateInputForActionType(finalActionType);
                if (currentActionDateInput) {
                    currentActionDateInput.min = minDateString;
                }
                 if (finalActionType.startsWith('tentativa')) {
                     const contactDateInput = document.getElementById('contact-date');
                     if (contactDateInput) contactDateInput.min = minDateString;
                 }

            } catch (e) { console.error("Erro ao calcular data mínima:", e); }
        }
    }

    // 4. Popula dados de edição (Lógica Inalterada, apenas ajustando seletores se necessário)
    if (isEditing) {
        switch (data.actionType) {
            case 'tentativa_1': case 'tentativa_2': case 'tentativa_3':
                document.getElementById('meeting-date').value = data.meetingDate || '';
                document.getElementById('meeting-time').value = data.meetingTime || '';
                const contactSucceededRadio = document.querySelector(`input[name="contact-succeeded"][value="${data.contactSucceeded}"]`);
                if (contactSucceededRadio) {
                    contactSucceededRadio.checked = true;
                    toggleFamilyContactFields(data.contactSucceeded === 'yes', document.getElementById('family-contact-fields'));
                } else {
                     document.querySelectorAll(`input[name="contact-succeeded"]`).forEach(r => r.checked = false);
                     toggleFamilyContactFields(false, document.getElementById('family-contact-fields'));
                }
                document.getElementById('absence-contact-type').value = data.contactType || '';
                document.getElementById('contact-date').value = data.contactDate || '';
                document.getElementById('contact-person').value = data.contactPerson || '';
                document.getElementById('contact-reason').value = data.contactReason || '';
                const contactReturnedRadio = document.querySelector(`input[name="contact-returned"][value="${data.contactReturned}"]`);
                if(contactReturnedRadio) contactReturnedRadio.checked = true;
                else document.querySelectorAll(`input[name="contact-returned"]`).forEach(r => r.checked = false);
                break;
            case 'visita':
                document.getElementById('visit-agent').value = data.visitAgent || '';
                document.getElementById('visit-date').value = data.visitDate || '';
                const visitSucceededRadio = document.querySelector(`input[name="visit-succeeded"][value="${data.visitSucceeded}"]`);
                if(visitSucceededRadio) {
                    visitSucceededRadio.checked = true;
                    toggleVisitContactFields(data.visitSucceeded === 'yes', document.getElementById('visit-contact-fields'));
                } else {
                     document.querySelectorAll(`input[name="visit-succeeded"]`).forEach(r => r.checked = false);
                     toggleVisitContactFields(false, document.getElementById('visit-contact-fields'));
                }
                document.getElementById('visit-contact-person').value = data.visitContactPerson || '';
                document.getElementById('visit-reason').value = data.visitReason || '';
                document.getElementById('visit-obs').value = data.visitObs || '';
                 const visitReturnedRadio = document.querySelector(`input[name="visit-returned"][value="${data.visitReturned}"]`);
                if (visitReturnedRadio) visitReturnedRadio.checked = true;
                else document.querySelectorAll(`input[name="visit-returned"]`).forEach(r => r.checked = false);
                break;
            case 'encaminhamento_ct':
                document.getElementById('ct-sent-date').value = data.ctSentDate || '';
                document.getElementById('oficio-number').value = data.oficioNumber || '';
                document.getElementById('oficio-year').value = data.oficioYear || '';
                
                document.getElementById('ct-feedback').value = data.ctFeedback || ''; 
                const ctReturnedRadio = document.querySelector(`input[name="ct-returned"][value="${data.ctReturned}"]`);
                if (ctReturnedRadio) ctReturnedRadio.checked = true;
                else document.querySelectorAll(`input[name="ct-returned"]`).forEach(r => r.checked = false);
                
                const ctGroup = document.getElementById('group-encaminhamento_ct');
                const fieldsets = ctGroup ? ctGroup.querySelectorAll('fieldset') : [];
                const ctSendSection = fieldsets.length > 0 ? fieldsets[0] : null;
                const ctFeedbackSection = fieldsets.length > 1 ? fieldsets[1] : null;

                if (ctSendSection && ctFeedbackSection) {
                    if(data.ctSentDate) { // Se já enviou, mostra o feedback
                        ctSendSection.classList.add('hidden');
                        ctFeedbackSection.classList.remove('hidden');
                    } else { // Se não enviou, volta para a seção de envio
                        ctSendSection.classList.remove('hidden');
                        ctFeedbackSection.classList.add('hidden');
                    }
                }
                break;
            case 'analise':
                document.getElementById('ct-parecer').value = data.ctParecer || '';
                break;
        }
    } else { 
        // Nova ação: garante que os campos de sub-detalhe estão escondidos
        toggleFamilyContactFields(false, document.getElementById('family-contact-fields'));
        toggleVisitContactFields(false, document.getElementById('visit-contact-fields'));
        document.querySelectorAll('input[name="contact-succeeded"], input[name="visit-succeeded"], input[name="contact-returned"], input[name="visit-returned"], input[name="ct-returned"]').forEach(r => r.checked = false);
    }

    openModal(dom.absenceModal);
};


// --- Funções de Handler ---

/**
 * Lida com a submissão do formulário de Busca Ativa.
 */
async function handleAbsenceSubmit(e) {
    e.preventDefault(); 
    const form = e.target;
    let firstInvalidField = null;
    
    form.querySelectorAll('input:not([disabled]), select:not([disabled]), textarea:not([disabled])').forEach(el => {
        if (el.required && !el.value && el.type !== 'radio') {
             if (!firstInvalidField) firstInvalidField = el;
        }
         if (el.type === 'radio' && el.required) {
             const groupName = el.name;
             const group = form.querySelectorAll(`input[name="${groupName}"]:not([disabled])`);
             const isGroupChecked = Array.from(group).some(radio => radio.checked);
             if (!isGroupChecked && !firstInvalidField) {
                  firstInvalidField = group[0];
             }
         }
    });

    if (firstInvalidField) {
         showToast(`Por favor, preencha o campo obrigatório: ${firstInvalidField.labels?.[0]?.textContent || firstInvalidField.name || firstInvalidField.placeholder || 'Campo Requerido'}`);
         firstInvalidField.focus();
         if (typeof firstInvalidField.reportValidity === 'function') {
             firstInvalidField.reportValidity();
         }
         return;
    }


    const data = getAbsenceFormData();
    if (!data) return; 

    const id = data.id; 
    
    if (id) {
        const existingAction = state.absences.find(a => a.id === id);
        if (existingAction) {
            for (const key in data) {
                if (data[key] === null && existingAction[key] != null) {
                    data[key] = existingAction[key];
                }
            }
        }
    }

    const { currentCycleActions } = getStudentProcessInfo(data.studentId);
    const dateCheck = validateAbsenceChronology(currentCycleActions, data);
    
    if (!dateCheck.isValid) {
        return showToast(dateCheck.message);
    }

    try {
        const historyAction = id ? "Dados da ação atualizados." : `Ação de Busca Ativa registada (${actionDisplayTitles[data.actionType]}).`;

        if (id) {
            const updateData = { ...data };
            delete updateData.id;
            await updateRecordWithHistory('absence', id, updateData, historyAction, state.userEmail);
        } else {
             const addData = { ...data };
             delete addData.id;
            await addRecordWithHistory('absence', addData, historyAction, state.userEmail);
        }

        showToast(`Ação ${id ? 'atualizada' : 'registada'} com sucesso!`);
        closeModal(dom.absenceModal);

        if (data.actionType === 'encaminhamento_ct' && data.oficioNumber && !id) { 
             const student = state.students.find(s => s.matricula === data.studentId);
             if (student) {
                generateAndShowOficio(data, data.oficioNumber);
             }
        }

        const studentReturned = (data.contactReturned === 'yes' || data.visitReturned === 'yes' || data.ctReturned === 'yes');
        if (studentReturned && data.actionType !== 'analise') {
            const student = state.students.find(s => s.matricula === data.studentId);
             setTimeout(() => {
                 const { currentCycleActions: updatedActions } = getStudentProcessInfo(data.studentId); 
                 if (student && !updatedActions.some(a => a.actionType === 'analise')) {
                    openAbsenceModalForStudent(student, 'analise'); 
                 }
             }, 400); 
        }
    } catch (error) {
        console.error("Erro ao salvar ação de BA:", error);
        showToast('Erro ao salvar ação.');
    }
}


/**
 * Coleta os dados do formulário de Busca Ativa.
 */
function getAbsenceFormData() {
    const studentId = dom.absenceForm.dataset.selectedStudentId;
    
    if (!studentId) {
        showToast("Erro: Aluno não identificado.");
        return null;
    }

    const studentName = document.getElementById('absence-student-name').value;
    // Captura dos campos ocultos
    const studentClass = document.getElementById('absence-student-class').value;

    const data = {
        id: document.getElementById('absence-id').value, 
        studentId: studentId, 
        studentName: studentName, 
        studentClass: studentClass, 
        actionType: document.getElementById('action-type').value,
        processId: document.getElementById('absence-process-id').value,
        
        periodoFaltasStart: document.getElementById('absence-start-date').readOnly ? null : document.getElementById('absence-start-date').value || null,
        periodoFaltasEnd: document.getElementById('absence-end-date').readOnly ? null : document.getElementById('absence-end-date').value || null,
        absenceCount: document.getElementById('absence-count').readOnly ? null : document.getElementById('absence-count').value || null,
        
        meetingDate: null, meetingTime: null, contactSucceeded: null, contactType: null, contactDate: null, contactPerson: null, contactReason: null, contactReturned: null,
        visitAgent: null, visitDate: null, visitSucceeded: null, visitContactPerson: null, visitReason: null, visitObs: null, visitReturned: null,
        ctSentDate: null, ctFeedback: null, ctReturned: null, oficioNumber: null, oficioYear: null,
        ctParecer: null
    };
    
    const actionType = data.actionType;

    if (actionType.startsWith('tentativa')) {
        if (!document.getElementById('convocation-section').classList.contains('hidden')) {
            data.meetingDate = document.getElementById('meeting-date').value || null;
            data.meetingTime = document.getElementById('meeting-time').value || null;
        }

        if (!document.getElementById('family-contact-section').classList.contains('hidden')) {
            const contactSucceededRadio = document.querySelector('input[name="contact-succeeded"]:checked');
            data.contactSucceeded = contactSucceededRadio ? contactSucceededRadio.value : null;
            
            if (data.contactSucceeded === 'yes') {
                data.contactType = document.getElementById('absence-contact-type').value || null;
                data.contactDate = document.getElementById('contact-date').value || null;
                data.contactPerson = document.getElementById('contact-person').value.trim() || null;
                data.contactReason = document.getElementById('contact-reason').value.trim() || null;
            }
            const contactReturnedRadio = document.querySelector('input[name="contact-returned"]:checked');
            data.contactReturned = contactReturnedRadio ? contactReturnedRadio.value : null;
        }

    } else if (actionType === 'visita') {
        data.visitAgent = document.getElementById('visit-agent').value.trim() || null;
        data.visitDate = document.getElementById('visit-date').value || null;

        const visitSucceededRadio = document.querySelector('input[name="visit-succeeded"]:checked');
        data.visitSucceeded = visitSucceededRadio ? visitSucceededRadio.value : null;
        
        if (data.visitSucceeded === 'yes') {
            data.visitContactPerson = document.getElementById('visit-contact-person').value.trim() || null;
            data.visitReason = document.getElementById('visit-reason').value.trim() || null;
            data.visitObs = document.getElementById('visit-obs').value.trim() || null;
        }
        const visitReturnedRadio = document.querySelector('input[name="visit-returned"]:checked');
        data.visitReturned = visitReturnedRadio ? visitReturnedRadio.value : null;

    } else if (actionType === 'encaminhamento_ct') {
        const hasCtSentData = document.getElementById('ct-sent-date').required;
        const hasCtFeedbackData = document.getElementById('ct-feedback').required;
        
        if (hasCtSentData) {
            data.ctSentDate = document.getElementById('ct-sent-date').value || null;
            data.oficioNumber = document.getElementById('oficio-number').value.trim() || null;
            data.oficioYear = document.getElementById('oficio-year').value.trim() || null;
        }

        if (hasCtFeedbackData) {
            data.ctFeedback = document.getElementById('ct-feedback').value.trim() || null; 
            const ctReturnedRadio = document.querySelector('input[name="ct-returned"]:checked');
            data.ctReturned = ctReturnedRadio ? ctReturnedRadio.value : null; 
        }

    } else if (actionType === 'analise') {
        data.ctParecer = document.getElementById('ct-parecer').value.trim() || null;
    }
    return data;
}


/**
 * Mostra/esconde campos dinâmicos no modal de Busca Ativa.
 */
function handleActionTypeChange(action) {
    document.querySelectorAll('.dynamic-field-group').forEach(group => group.classList.add('hidden'));
    const groupToShow = action.startsWith('tentativa') ? 'group-tentativas' : `group-${action}`;
    const groupElement = document.getElementById(groupToShow);
    if (groupElement) groupElement.classList.remove('hidden');
}

/**
 * Lida com o clique de "Ver Ofício".
 */
function handleViewOficio(id) {
    const ctAction = state.absences.find(a => a.id === id);
    if (ctAction && ctAction.oficioNumber) {
        generateAndShowOficio(ctAction, ctAction.oficioNumber); 
    } else {
        showToast("Registro de encaminhamento ou número do ofício não encontrado.");
    }
}


/**
 * Lida com o clique no nome do aluno (iniciar nova ação) ou botão Avançar.
 */
async function handleNewAbsenceFromHistory(studentId) {
    let student = state.students.find(s => s.matricula === studentId);
    
    if (!student) {
        showToast("A carregar dados do aluno...");
        try {
            student = await getStudentById(studentId);
        } catch (error) {
            console.error("Erro ao buscar aluno:", error);
        }
    }

    if (student) {
        handleNewAbsenceAction(student); 
    } else {
        showToast("Erro: Aluno não encontrado no sistema.");
    }
}


/**
 * Lida com a edição de uma ação (chamado pelo listener).
 */
function handleEditAbsence(id) {
    const data = state.absences.find(a => a.id === id);
    if (!data) return showToast("Ação não encontrada.");

    const processActions = state.absences
        .filter(a => a.processId === data.processId)
        .sort((a, b) => { 
            const dateA = getActionMainDate(a) || a.createdAt?.seconds || 0;
            const dateB = getActionMainDate(b) || b.createdAt?.seconds || 0;
            const timeA = typeof dateA === 'string' ? new Date(dateA+'T00:00:00Z').getTime() : (dateA instanceof Date ? dateA.getTime() : (dateA || 0) * 1000);
            const timeB = typeof dateB === 'string' ? new Date(dateB+'T00:00:00Z').getTime() : (dateB instanceof Date ? dateB.getTime() : (dateB || 0) * 1000);
             if (timeA === timeB) {
                 const createA = a.createdAt?.seconds || (a.createdAt instanceof Date ? a.createdAt.getTime() / 1000 : 0);
                 const createB = b.createdAt?.seconds || (b.createdAt instanceof Date ? b.createdAt.getTime() / 1000 : 0);
                 return (createA || 0) - (createB || 0);
             }
            return (timeA || 0) - (timeB || 0);
        });

    const lastProcessAction = processActions[processActions.length - 1];
    const isConcluded = processActions.some(a => a.actionType === 'analise');

    if (isConcluded || data.id !== lastProcessAction?.id) { 
        return showToast(isConcluded ? "Processo concluído, não pode editar." : "Apenas a última ação pode ser editada.");
    }

    let student = state.students.find(s => s.matricula === data.studentId);
    
    if (!student) {
        student = {
            matricula: data.studentId,
            name: data.studentName || `Aluno (${data.studentId})`, 
            class: data.studentClass || '', 
            endereco: '', 
            contato: ''
        };
    }

    if (student) {
        openAbsenceModalForStudent(student, data.actionType, data); 
    }
}


/**
 * Lida com a exclusão de uma ação (chamado pelo listener).
 */
function handleDeleteAbsence(id) {
    const actionToDelete = state.absences.find(a => a.id === id);
    if (!actionToDelete) return;

    const processActions = state.absences
        .filter(a => a.processId === actionToDelete.processId)
        .sort((a, b) => { 
            const dateA = getActionMainDate(a) || a.createdAt?.seconds || 0;
            const dateB = getActionMainDate(b) || b.createdAt?.seconds || 0;
            const timeA = typeof dateA === 'string' ? new Date(dateA+'T00:00:00Z').getTime() : (dateA instanceof Date ? dateA.getTime() : (dateA || 0) * 1000);
            const timeB = typeof dateB === 'string' ? new Date(dateB+'T00:00:00Z').getTime() : (dateB instanceof Date ? dateB.getTime() : (dateB || 0) * 1000);
             if (timeA === timeB) {
                 const createA = a.createdAt?.seconds || (a.createdAt instanceof Date ? a.createdAt.getTime() / 1000 : 0);
                 const createB = b.createdAt?.seconds || (b.createdAt instanceof Date ? b.createdAt.getTime() / 1000 : 0);
                 return (createA || 0) - (createB || 0);
             }
            return (timeA || 0) - (timeB || 0);
        });

    const lastProcessAction = processActions.length > 0 ? processActions[processActions.length - 1] : null;
    const isConcluded = processActions.some(a => a.actionType === 'analise');

    if (isConcluded || !lastProcessAction || actionToDelete.id !== lastProcessAction.id) {
        return showToast(isConcluded ? "Processo concluído, não pode excluir." : "Apenas a última ação pode ser excluída.");
    }

    document.getElementById('delete-confirm-message').textContent = 'Tem certeza que deseja Limpar esta ação? Esta ação não pode ser desfeita.';
    state.recordToDelete = { type: 'absence', id: id };
    openModal(dom.deleteConfirmModal);
}


// --- Função Principal de Inicialização ---

export const initAbsenceListeners = () => {
    if (dom.addAbsenceBtn) {
        dom.addAbsenceBtn.addEventListener('click', openAbsenceSearchFlowModal);
    }
    
    if (dom.searchAbsences) {
        dom.searchAbsences.addEventListener('input', (e) => {
            state.filterAbsences = e.target.value; 
            document.getElementById('absence-student-suggestions').classList.add('hidden');
            renderAbsences();
        });
    }

    if (dom.generalBaReportBtn) {
        dom.generalBaReportBtn.addEventListener('click', generateAndShowBuscaAtivaReport);
    }
    
    document.getElementById('filter-process-status').addEventListener('change', (e) => { state.filtersAbsences.processStatus = e.target.value; renderAbsences(); });
    document.getElementById('filter-pending-action').addEventListener('change', (e) => { state.filtersAbsences.pendingAction = e.target.value; renderAbsences(); });
    document.getElementById('filter-return-status').addEventListener('change', (e) => { state.filtersAbsences.returnStatus = e.target.value; renderAbsences(); });
    document.getElementById('absence-start-date-filter').addEventListener('change', (e) => {
        state.filtersAbsences.startDate = e.target.value;
        renderAbsences();
    });
    document.getElementById('absence-end-date-filter').addEventListener('change', (e) => {
        state.filtersAbsences.endDate = e.target.value;
        renderAbsences();
    });

    if (dom.absenceForm) {
        dom.absenceForm.addEventListener('submit', handleAbsenceSubmit);
    } else {
        console.error("ERRO CRÍTICO: Dom.absenceForm não encontrado ao inicializar listeners. A submissão do formulário causará recarga da página.");
    }
    
    document.querySelectorAll('input[name="contact-succeeded"]').forEach(radio => radio.addEventListener('change', (e) => toggleFamilyContactFields(e.target.value === 'yes', document.getElementById('family-contact-fields'))));
    document.querySelectorAll('input[name="visit-succeeded"]').forEach(radio => radio.addEventListener('change', (e) => toggleVisitContactFields(e.target.value === 'yes', document.getElementById('visit-contact-fields'))));

    dom.absencesListDiv.addEventListener('click', (e) => {
        
        const button = e.target.closest('button');
        if (button) {
            e.stopPropagation(); 
            
            if (button.closest('.process-content')) {
                const id = button.dataset.id; 
                
                if (button.classList.contains('view-notification-btn-hist')) {
                    if (id) {
                         try {
                             openFichaViewModal(id);
                         } catch (error) {
                             console.error("Erro ao abrir ficha:", error);
                             showToast("Erro ao abrir a notificação.");
                         }
                    } else {
                        showToast("ID da notificação não encontrado.");
                    }
                    return;
                }

                if (button.classList.contains('view-oficio-btn-hist')) {
                    if (id) handleViewOficio(id);
                    return; 
                }
                
                if (button.classList.contains('avancar-etapa-btn') && !button.disabled) {
                    handleNewAbsenceFromHistory(button.dataset.studentId);
                    return;
                }
                if (button.classList.contains('edit-absence-action-btn') && !button.disabled) {
                    handleEditAbsence(id);
                    return;
                }
                if (button.classList.contains('reset-absence-action-btn') && !button.disabled) {
                    handleDeleteAbsence(id); 
                    return;
                }
            }
            
            if (button.classList.contains('generate-ficha-btn-row')) {
                 generateAndShowConsolidatedFicha(button.dataset.studentId, button.dataset.processId);
                 return;
            }

            return; 
        } 

        const header = e.target.closest('.process-header');
        if (header) {
            const contentId = header.dataset.contentId;
            const content = document.getElementById(contentId);
            const icon = header.querySelector('i.fa-chevron-down');
            if (content) {
                const isHidden = !content.style.maxHeight || content.style.maxHeight === '0px';
                if (isHidden) {
                    content.style.maxHeight = `${content.scrollHeight}px`;
                    content.style.overflow = 'visible';
                } else {
                    content.style.maxHeight = null;
                     setTimeout(() => content.style.overflow = 'hidden', 300);
                }
                icon?.classList.toggle('rotate-180', isHidden);
            }
            return; 
        }
        
    }); 
};