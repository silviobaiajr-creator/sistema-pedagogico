
// =================================================================================
// ARQUIVO: absence.js 
// VERSÃO: 5.6 (Cronômetro de Dias e Próxima Ação)
// =================================================================================

import { state, dom } from './state.js';
import { showToast, showAlert, openModal, closeModal, formatDate, formatTime, getStatusBadge, compressImage, openImageModal } from './utils.js';
import { getStudentProcessInfo, determineNextActionForStudent, validateAbsenceChronology } from './logic.js'; 
import { actionDisplayTitles, openFichaViewModal, generateAndShowConsolidatedFicha, generateAndShowOficio, openAbsenceHistoryModal, generateAndShowBuscaAtivaReport } from './reports.js';
import { updateRecordWithHistory, addRecordWithHistory, deleteRecord, getCollectionRef, searchStudentsByName, getStudentById } from './firestore.js'; 
import { doc, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from './firebase.js';


// --- Funções Auxiliares ---

// Lista de strings Base64
let pendingAbsenceImagesBase64 = []; 

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
// FUNÇÃO AUXILIAR: RENDERIZAR PREVIEW DE IMAGENS
// =================================================================================

const renderImagePreviews = (containerId) => {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    container.innerHTML = '';
    
    if (pendingAbsenceImagesBase64.length === 0) {
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');
    container.className = "flex flex-wrap gap-2 mt-2";

    pendingAbsenceImagesBase64.forEach((imgSrc, index) => {
        const wrapper = document.createElement('div');
        wrapper.className = "relative group w-16 h-16 border rounded bg-gray-100 overflow-hidden";
        
        const img = document.createElement('img');
        img.src = imgSrc;
        img.className = "w-full h-full object-cover cursor-pointer";
        img.onclick = () => window.viewImage(imgSrc, `Anexo ${index + 1}`);
        
        const removeBtn = document.createElement('button');
        removeBtn.className = "absolute top-0 right-0 bg-red-500 text-white text-xs w-5 h-5 flex items-center justify-center opacity-80 hover:opacity-100";
        removeBtn.innerHTML = "&times;";
        removeBtn.type = "button";
        removeBtn.onclick = (e) => {
            e.stopPropagation();
            pendingAbsenceImagesBase64.splice(index, 1);
            
            // Atualiza Label e Check (Reutiliza lógica do evento)
            const labelEl = document.getElementById('absence-print-label');
            if(labelEl) labelEl.textContent = pendingAbsenceImagesBase64.length > 0 ? `${pendingAbsenceImagesBase64.length} Imagens` : 'Selecionar Imagens';
            
            const checkEl = document.getElementById('absence-print-check');
            if(checkEl && pendingAbsenceImagesBase64.length === 0) checkEl.classList.add('hidden');

            renderImagePreviews(containerId);
        };
        
        wrapper.appendChild(img);
        wrapper.appendChild(removeBtn);
        container.appendChild(wrapper);
    });
};

// =================================================================================
// FUNÇÕES DE FLUXO DE BUSCA
// =================================================================================

let absenceSearchTimeout = null;

export const openAbsenceSearchFlowModal = () => {
    const input = document.getElementById('absence-search-flow-input');
    const suggestionsContainer = document.getElementById('absence-search-flow-suggestions');
    const resultsContainer = document.getElementById('absence-search-flow-results');

    input.value = '';
    suggestionsContainer.innerHTML = '';
    suggestionsContainer.classList.add('hidden');
    resultsContainer.innerHTML = '<p class="text-sm text-gray-400 text-center">Comece a digitar o nome do aluno acima.</p>';

    setupAbsenceSearchFlowAutocomplete(input, suggestionsContainer);
    
    const closeBtn = document.getElementById('close-absence-search-flow-modal-btn');
    const cancelBtn = document.getElementById('cancel-absence-search-flow-btn');
    if (closeBtn) closeBtn.onclick = () => closeModal(dom.absenceSearchFlowModal);
    if (cancelBtn) cancelBtn.onclick = () => closeModal(dom.absenceSearchFlowModal);

    openModal(dom.absenceSearchFlowModal);
};

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
                const results = await searchStudentsByName(rawValue);
                suggestionsContainer.innerHTML = ''; 
                
                if (results.length > 0) {
                    results.forEach(student => {
                        const item = document.createElement('div');
                        item.className = 'suggestion-item p-2 cursor-pointer hover:bg-emerald-50 border-b border-gray-100';
                        item.innerHTML = `<span class="font-semibold text-gray-800">${student.name}</span> <span class="text-xs text-gray-500">(${student.class || 'S/ Turma'})</span>`;
                        
                        item.addEventListener('click', () => {
                            if (!state.students.find(s => s.matricula === student.matricula)) {
                                state.students.push(student);
                            }
                            handleNewAbsenceAction(student); 
                            closeModal(dom.absenceSearchFlowModal); 
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

const getTimeSinceUpdate = (dateString) => {
    if (!dateString) return { text: 'Novo', days: 0 };
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays <= 1) return { text: 'Atualizado hoje', days: 0 };
    return { text: `${diffDays} dias parado`, days: diffDays };
};

const getNextActionDisplay = (actionType) => {
    const titles = {
        'tentativa_1': '1ª Tentativa', 'tentativa_2': '2ª Tentativa', 'tentativa_3': '3ª Tentativa',
        'visita': 'Visita Domiciliar', 'encaminhamento_ct': 'Envio ao Conselho', 'analise': 'Finalizar / Análise'
    };
    return titles[actionType] || 'Próxima Etapa';
};

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
        // ... (Lógica de filtragem complexa mantida idêntica à versão anterior) ...
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
            let isCurrentlyPendingContact = (lastAction.actionType.startsWith('tentativa') && lastAction.contactSucceeded == null) || (lastAction.actionType === 'visita' && lastAction.visitSucceeded == null);
            let isCurrentlyPendingFeedback = false;
            const ctAction = actions.find(a => a.actionType === 'encaminhamento_ct');
            if (ctAction && !isConcluded) isCurrentlyPendingFeedback = ctAction.ctFeedback == null;
            if (pendingAction === 'pending_contact' && !isCurrentlyPendingContact) return false;
            if (pendingAction === 'pending_feedback' && !isCurrentlyPendingFeedback) return false;
        }
        if (returnStatus !== 'all') {
             const lastActionWithReturnInfo = [...actions].reverse().find(a => a.contactReturned === 'yes' || a.contactReturned === 'no' || a.visitReturned === 'yes' || a.visitReturned === 'no' || a.ctReturned === 'yes' || a.ctReturned === 'no');
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
        // ... (Mensagens de empty state mantidas) ...
        const hasActiveFilters = state.filterAbsences !== '' || state.filtersAbsences.processStatus !== 'all' || state.filtersAbsences.pendingAction !== 'all' || state.filtersAbsences.returnStatus !== 'all' || state.filtersAbsences.startDate || state.filtersAbsences.endDate;
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

            // --- LÓGICA DE ALERTA DE TEMPO E PRÓXIMA AÇÃO ---
            const lastUpdateDate = lastProcessAction.createdAt?.toDate ? lastProcessAction.createdAt.toDate() : (new Date(lastProcessAction.createdAt) || new Date());
            const { text: timeText, days: stalledDays } = getTimeSinceUpdate(lastUpdateDate);
            
            // Define cor do badge de tempo
            let timeBadgeColor = 'bg-gray-200 text-gray-700';
            if (stalledDays > 7 && !isConcluded) timeBadgeColor = 'bg-red-100 text-red-800 font-bold';
            else if (stalledDays > 3 && !isConcluded) timeBadgeColor = 'bg-yellow-100 text-yellow-800';

            // Determina próxima ação
            const nextActionType = determineNextActionForStudent(firstAction.studentId);
            const nextActionText = isConcluded ? "Concluído" : `Próx: ${getNextActionDisplay(nextActionType)}`;

            // Verifica "Não Retornou" para pintar o fundo
            const lastReturnAction = [...actions].reverse().find(a => a.contactReturned != null || a.visitReturned != null || a.ctReturned != null);
            const didNotReturn = lastReturnAction && (lastReturnAction.contactReturned === 'no' || lastReturnAction.visitReturned === 'no' || lastReturnAction.ctReturned === 'no');
            const cardBgClass = didNotReturn && !isConcluded ? 'bg-red-50 border-red-200' : 'bg-white';
            
            let historyHtml = '';
            // ... (Lógica de historyHtml mantida idêntica à versão anterior) ...
            actions.forEach(abs => {
                const actionDisplayDate = getActionMainDate(abs) || (abs.createdAt?.toDate() ? abs.createdAt.toDate().toISOString().split('T')[0] : '');
                const returned = abs.contactReturned === 'yes' || abs.visitReturned === 'yes' || abs.ctReturned === 'yes';
                const notReturned = abs.contactReturned === 'no' || abs.visitReturned === 'no' || abs.ctReturned === 'no';
                let statusHtml = '';
                let showQuickButtons = false;
                if (abs.actionType.startsWith('tentativa')) {
                    if (abs.contactSucceeded === 'yes') statusHtml = `<span class="text-xs text-green-600 font-semibold ml-1">(<i class="fas fa-check"></i> Contato Realizado)</span>`;
                    else if (abs.contactSucceeded === 'no') statusHtml = `<span class="text-xs text-red-600 font-semibold ml-1">(<i class="fas fa-times"></i> Sem Sucesso)</span>`;
                    else if (abs.meetingDate) { statusHtml = `<span class="text-xs text-yellow-600 font-semibold ml-1">(<i class="fas fa-hourglass-half"></i> Aguardando)</span>`; showQuickButtons = true; } 
                    else statusHtml = `<span class="text-xs text-blue-600 font-semibold ml-1">(<i class="fas fa-hourglass-start"></i> Agendando)</span>`;
                } else if (abs.actionType === 'visita') {
                     if (abs.visitSucceeded === 'yes') statusHtml = `<span class="text-xs text-green-600 font-semibold ml-1">(<i class="fas fa-check"></i> Realizado)</span>`;
                    else if (abs.visitSucceeded === 'no') statusHtml = `<span class="text-xs text-red-600 font-semibold ml-1">(<i class="fas fa-times"></i> Sem Sucesso)</span>`;
                    else { statusHtml = `<span class="text-xs text-yellow-600 font-semibold ml-1">(<i class="fas fa-hourglass-half"></i> Aguardando)</span>`; showQuickButtons = true; }
                } else if (abs.actionType === 'encaminhamento_ct') {
                    if (abs.ctFeedback) statusHtml = `<span class="text-xs text-green-600 font-semibold ml-1">(<i class="fas fa-inbox"></i> Devolutiva Recebida)</span>`;
                    else if (abs.ctSentDate) statusHtml = `<span class="text-xs text-yellow-600 font-semibold ml-1">(<i class="fas fa-hourglass-half"></i> Aguardando Devolutiva)</span>`;
                }
                let viewButtonHtml = '';
                if (abs.actionType.startsWith('tentativa') && abs.meetingDate && abs.meetingTime) viewButtonHtml = `<button type="button" class="view-notification-btn-hist text-sky-600 hover:text-sky-900 text-xs font-semibold ml-2 cursor-pointer" data-id="${abs.id}" title="Ver Notificação">[<i class="fas fa-eye fa-fw"></i> Ver Notificação]</button>`; 
                if (abs.actionType === 'encaminhamento_ct' && abs.oficioNumber) viewButtonHtml = `<button type="button" class="view-oficio-btn-hist text-green-600 hover:text-green-900 text-xs font-semibold ml-2 cursor-pointer" data-id="${abs.id}" title="Ver Ofício ${abs.oficioNumber}/${abs.oficioYear || ''}">[<i class="fas fa-eye fa-fw"></i> Ver Ofício]</button>`;
                let imagesToShow = [];
                if (abs.contactPrints && Array.isArray(abs.contactPrints) && abs.contactPrints.length > 0) imagesToShow = abs.contactPrints;
                else if (abs.contactPrint) imagesToShow = [abs.contactPrint];
                if (imagesToShow.length > 0) {
                     const btnLabel = imagesToShow.length > 1 ? `[<i class="fas fa-images fa-fw"></i> Ver ${imagesToShow.length} Prints]` : `[<i class="fas fa-image fa-fw"></i> Ver Print]`;
                     viewButtonHtml += `<button type="button" class="text-purple-600 hover:text-purple-800 text-xs font-semibold ml-2 cursor-pointer" onclick="window.viewImage('${imagesToShow[0]}', 'Anexo 1 de ${imagesToShow.length}')">${btnLabel}</button>`;
                }
                historyHtml += `<div class="mb-2 pb-2 border-b border-gray-100 last:border-0"><p class="text-xs text-gray-600 flex items-center flex-wrap"><i class="fas fa-check text-emerald-500 fa-fw mr-1"></i> <strong>${actionDisplayTitles[abs.actionType] || 'N/A'}</strong> (Data: ${formatDate(actionDisplayDate)}) ${statusHtml} ${returned ? '<span class="text-xs text-green-600 font-semibold ml-1">[<i class="fas fa-check-circle"></i> Retornou]</span>' : ''} ${notReturned ? '<span class="text-xs text-red-600 font-semibold ml-1">[<i class="fas fa-times-circle"></i> Não Retornou]</span>' : ''} ${viewButtonHtml}</p>${showQuickButtons ? `<div class="mt-1 ml-5 flex items-center gap-2"><span class="text-xs text-yellow-700 font-medium">Conseguiu contato?</span><button type="button" class="quick-feedback-ba-btn bg-green-100 text-green-700 hover:bg-green-200 text-xs px-2 py-0.5 rounded border border-green-300 transition" data-id="${abs.id}" data-student-id="${firstAction.studentId}" data-action-type="${abs.actionType}" data-value="yes">Sim</button><button type="button" class="quick-feedback-ba-btn bg-red-100 text-red-700 hover:bg-red-200 text-xs px-2 py-0.5 rounded border border-red-300 transition" data-id="${abs.id}" data-student-id="${firstAction.studentId}" data-action-type="${abs.actionType}" data-value="no">Não</button></div>` : ''}</div>`;
            });
            
            const disableEditDelete = isConcluded || !lastProcessAction;
            const disableReason = isConcluded ? "Processo concluído" : "Apenas a última ação pode ser alterada";
            const avancarBtn = `<button type="button" class="avancar-etapa-btn text-sky-600 hover:text-sky-900 text-xs font-semibold py-1 px-2 rounded-md bg-sky-50 hover:bg-sky-100 ${isConcluded ? 'opacity-50 cursor-not-allowed' : ''}" title="${isConcluded ? 'Processo concluído' : 'Avançar para a próxima etapa'}" ${isConcluded ? 'disabled' : ''} data-student-id="${firstAction.studentId}"><i class="fas fa-plus"></i> Nova Etapa</button>`; 
            const editBtn = `<button type="button" class="edit-absence-action-btn text-yellow-600 hover:text-yellow-900 text-xs font-semibold py-1 px-2 rounded-md bg-yellow-50 hover:bg-yellow-100 ${disableEditDelete ? 'opacity-50 cursor-not-allowed' : ''}" title="${disableReason}" ${disableEditDelete ? 'disabled' : ''} data-id="${lastProcessAction.id}"><i class="fas fa-pencil-alt"></i> Editar Ação</button>`;
            const limparBtn = `<button type="button" class="reset-absence-action-btn text-red-600 hover:text-red-900 text-xs font-semibold py-1 px-2 rounded-md bg-red-50 hover:bg-red-100 ${disableEditDelete ? 'opacity-50 cursor-not-allowed' : ''}" title="${disableReason}" ${disableEditDelete ? 'disabled' : ''} data-id="${lastProcessAction.id}"><i class="fas fa-undo-alt"></i> Limpar Ação</button>`;
            const contentId = `ba-content-${processId}`;

            html += `
                <div class="border rounded-lg mb-4 ${cardBgClass} shadow">
                    <div class="process-header hover:bg-gray-50 cursor-pointer p-4 flex flex-col sm:flex-row justify-between sm:items-center gap-3" data-content-id="${contentId}">
                        <div class="flex-grow">
                            <div class="flex items-center justify-between mb-1">
                                <p class="font-bold text-gray-800 text-base">${studentName}</p>
                                ${isConcluded ? '<span class="text-xs font-bold text-white bg-green-600 px-2 py-1 rounded-full ml-2">CONCLUÍDO</span>' : '<span class="text-xs font-bold text-white bg-yellow-600 px-2 py-1 rounded-full ml-2">EM ANDAMENTO</span>'}
                            </div>
                            <p class="text-sm text-gray-600">Turma: ${studentClass} | Início: ${formatDate(firstAction.createdAt?.toDate())}</p>
                            
                            <!-- INFO EXTRA (NOVO) -->
                            <div class="mt-2 flex items-center gap-3">
                                <span class="text-xs px-2 py-0.5 rounded-full ${timeBadgeColor} border border-gray-200">
                                    <i class="far fa-clock"></i> ${timeText}
                                </span>
                                ${!isConcluded ? `
                                    <span class="text-xs text-sky-700 font-semibold bg-sky-50 px-2 py-0.5 rounded-full border border-sky-100">
                                        <i class="fas fa-arrow-right"></i> ${nextActionText}
                                    </span>
                                ` : ''}
                            </div>
                        </div>

                        <div class="flex items-center space-x-2 self-end sm:self-center">
                            <button class="generate-ficha-btn-row bg-teal-600 text-white font-bold py-1.5 px-3 rounded-lg shadow-md hover:bg-teal-700 text-xs no-print whitespace-nowrap" data-student-id="${firstAction.studentId}" data-process-id="${processId}">
                                <i class="fas fa-file-invoice"></i> Ficha
                            </button>
                            <i class="fas fa-chevron-down transition-transform duration-300 ml-2"></i>
                        </div>
                    </div>
                    
                    <div class="process-content" id="${contentId}" style="max-height: 0px; overflow: hidden;">
                        <div class="p-4 border-t border-gray-200 bg-white">
                             <h5 class="text-xs font-bold uppercase text-gray-500 mb-2">Histórico Individual</h5>
                             <div class="space-y-1 mb-3">${historyHtml}</div>
                             <h5 class="text-xs font-bold uppercase text-gray-500 mb-2 mt-4">Ações</h5>
                             <div class="flex items-center flex-wrap gap-2">${avancarBtn}${editBtn}${limparBtn}</div>
                        </div>
                    </div>
                </div>
            `;
        } 
        dom.absencesListDiv.innerHTML = html; 
    }
};

// ... (Resto do arquivo absence.js mantido com a lógica de modais e handlers) ...
// (Lógica de handlers e listeners inalterada, apenas renderAbsences foi melhorado)

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
            if (lastAction.meetingDate == null) { isPending = true; pendingActionMessage = "Registre a Data/Hora da Convocação."; }
            else if (lastAction.contactSucceeded == null) { isPending = true; pendingActionMessage = "Registre se houve sucesso no contato."; } 
            else if (lastAction.contactReturned == null && lastAction.contactSucceeded === 'yes') { isPending = true; pendingActionMessage = "Registre se o aluno retornou após o contato."; }
        } else if (lastAction.actionType === 'visita') {
            if (lastAction.visitSucceeded == null) { isPending = true; pendingActionMessage = "Registre se houve sucesso no contato da visita."; } 
            else if (lastAction.visitReturned == null) { isPending = true; pendingActionMessage = "Registre se o aluno retornou após a visita."; }
        } else if (lastAction.actionType === 'encaminhamento_ct') {
             if (lastAction.ctSentDate == null) { isPending = true; pendingActionMessage = "Registre a Data, Nº e Ano do Ofício."; }
            else if (lastAction.ctFeedback == null) { isPending = true; pendingActionMessage = "Registre a devolutiva recebida do Conselho Tutelar."; } 
            else if (lastAction.ctReturned == null) { isPending = true; pendingActionMessage = "Registre se o aluno retornou."; }
        }
        if (isPending) {
            showAlert(pendingActionMessage);
            openAbsenceModalForStudent(student, lastAction.actionType, lastAction); 
            return;
        }
    }
    const nextActionType = determineNextActionForStudent(student.matricula);
    if (nextActionType) {
        openAbsenceModalForStudent(student, nextActionType); 
    } else {
        showAlert("Processo já concluído ou em etapa final."); 
    }
};

export const toggleFamilyContactFields = (enable, fieldsContainer) => {
    if (!fieldsContainer) return;
    fieldsContainer.classList.toggle('hidden', !enable);
    const detailFields = fieldsContainer.querySelectorAll('input, textarea, select');
    const returnedRadioGroup = document.querySelectorAll('input[name="contact-returned"]');
    detailFields.forEach(input => {
        if(input.type === 'file') return; 
        input.disabled = !enable;
        input.required = enable; 
        if (!enable) { input.classList.add('bg-gray-200', 'cursor-not-allowed'); input.value = ''; } 
        else { input.classList.remove('bg-gray-200', 'cursor-not-allowed'); }
    });
    returnedRadioGroup.forEach(radio => { radio.required = false; radio.disabled = false; if (!enable) radio.checked = false; });
};

export const toggleVisitContactFields = (enable, fieldsContainer) => {
     if (!fieldsContainer) return;
     fieldsContainer.classList.toggle('hidden', !enable);
     const detailFields = fieldsContainer.querySelectorAll('input[type="text"], textarea');
     const returnedRadioGroup = document.querySelectorAll('input[name="visit-returned"]');
     detailFields.forEach(input => {
        input.disabled = !enable;
        input.required = enable; 
        if (!enable) { input.classList.add('bg-gray-200', 'cursor-not-allowed'); input.value = ''; } 
        else { input.classList.remove('bg-gray-200', 'cursor-not-allowed'); }
    });
    returnedRadioGroup.forEach(radio => radio.required = enable);
};

export const openAbsenceModalForStudent = (student, forceActionType = null, data = null, preFilledData = null) => {
    dom.absenceForm.reset();
    pendingAbsenceImagesBase64 = []; 
    document.getElementById('absence-print-label').textContent = 'Selecionar Imagens';
    document.getElementById('absence-print-check').classList.add('hidden');
    let previewContainer = document.getElementById('absence-print-preview');
    if (!previewContainer) {
        const fileInput = document.getElementById('absence-contact-print');
        if (fileInput) {
             fileInput.setAttribute('multiple', 'multiple');
            previewContainer = document.createElement('div');
            previewContainer.id = 'absence-print-preview';
            previewContainer.className = 'flex flex-wrap gap-2 mt-2 hidden';
            fileInput.parentElement.parentElement.appendChild(previewContainer);
        }
    } else {
        previewContainer.innerHTML = '';
        previewContainer.classList.add('hidden');
    }

    ['meeting-date', 'contact-date', 'visit-date', 'ct-sent-date'].forEach(id => { 
        const input = document.getElementById(id);
        if (input) input.removeAttribute('min');
    });
    dom.absenceForm.querySelectorAll('[required]').forEach(el => el.required = false);
    document.querySelectorAll('.dynamic-field-group').forEach(group => group.classList.add('hidden'));
    
    const statusDisplay = document.getElementById('absence-status-display');
    const finalActionType = forceActionType || (data ? data.actionType : determineNextActionForStudent(student.matricula));
    
    let statusText = 'Em Andamento';
    let statusColor = 'bg-blue-100 text-blue-800';
    if (finalActionType === 'analise') { statusText = 'Aguardando Análise BAE'; statusColor = 'bg-purple-100 text-purple-800'; } 
    else if (finalActionType.startsWith('tentativa')) { statusText = `Tentativa ${finalActionType.split('_')[1]}`; } 
    else if (finalActionType === 'encaminhamento_ct') { statusText = 'Encaminhamento CT'; } 
    else if (finalActionType === 'visita') { statusText = 'Visita Domiciliar'; }

    if (statusDisplay) {
        statusDisplay.innerHTML = `<strong>Etapa:</strong> <span class="text-xs font-medium px-2.5 py-0.5 rounded-full ${statusColor} ml-2">${statusText}</span>`;
    }

    const studentIdentityBlock = document.querySelector('#absence-form fieldset:first-of-type');
    const absencePeriodData = document.getElementById('absence-period-data');
    const isEditing = !!data;
    document.getElementById('absence-modal-title').innerText = isEditing ? 'Editar Ação de Busca Ativa' : 'Acompanhamento Busca Ativa';
    document.getElementById('absence-id').value = isEditing ? data.id : '';
    dom.absenceForm.dataset.selectedStudentId = student.matricula;
    document.getElementById('absence-student-name').value = student.name || '';
    document.getElementById('absence-student-class').value = student.class || '';
    document.getElementById('absence-student-endereco').value = student.endereco || '';
    document.getElementById('absence-student-contato').value = student.contato || '';
    
    const { processId, currentCycleActions } = getStudentProcessInfo(student.matricula);
    document.getElementById('absence-process-id').value = data?.processId || processId;
    document.getElementById('action-type').value = finalActionType;
    document.getElementById('action-type-display').value = actionDisplayTitles[finalActionType] || '';
    
    const isFirstStep = finalActionType === 'tentativa_1';
    const firstAbsenceRecordInCycle = currentCycleActions.find(a => a.periodoFaltasStart);
    const isAbsenceDataEditable = isFirstStep && !firstAbsenceRecordInCycle; 
    
    if (isFirstStep) {
        if (studentIdentityBlock) studentIdentityBlock.classList.remove('hidden');
        absencePeriodData.classList.remove('hidden');
    } else {
        if (studentIdentityBlock) studentIdentityBlock.classList.add('hidden');
        absencePeriodData.classList.add('hidden');
    }

    const absenceInputs = absencePeriodData.querySelectorAll('input');
    const shouldRequireAbsenceData = isAbsenceDataEditable && !absencePeriodData.classList.contains('hidden');
    document.getElementById('absence-start-date').required = shouldRequireAbsenceData;
    document.getElementById('absence-end-date').required = shouldRequireAbsenceData;
    document.getElementById('absence-count').required = shouldRequireAbsenceData;

    if (isAbsenceDataEditable) {
        absenceInputs.forEach(input => { input.readOnly = false; input.classList.remove('bg-gray-100'); });
    } else {
        const sourceData = isEditing && data.actionType === 'tentativa_1' ? data : firstAbsenceRecordInCycle;
        document.getElementById('absence-start-date').value = sourceData?.periodoFaltasStart || '';
        document.getElementById('absence-end-date').value = sourceData?.periodoFaltasEnd || '';
        document.getElementById('absence-count').value = sourceData?.absenceCount || '';
        absenceInputs.forEach(input => { input.readOnly = true; input.classList.add('bg-gray-100'); });
    }

    const groupElement = document.getElementById(finalActionType.startsWith('tentativa') ? 'group-tentativas' : `group-${finalActionType}`);
    if (groupElement) groupElement.classList.remove('hidden');
    const printContainer = document.getElementById('absence-print-container');
    if(printContainer) printContainer.classList.add('hidden');

    switch (finalActionType) {
        case 'tentativa_1': case 'tentativa_2': case 'tentativa_3':
            const convocationSection = document.getElementById('convocation-section');
            const familyContactSection = document.getElementById('family-contact-section');
            const hasConvocation = !!(data?.meetingDate);
            const isContactStep = isEditing && hasConvocation && data.contactSucceeded == null;
            if ((isEditing && isContactStep) || (hasConvocation && !isEditing) || (isEditing && hasConvocation)) {
                convocationSection.classList.add('hidden');
                familyContactSection.classList.remove('hidden');
                document.querySelectorAll('input[name="contact-succeeded"]').forEach(r => r.required = true);
                document.querySelectorAll('input[name="contact-returned"]').forEach(r => r.required = false);
                if(printContainer) printContainer.classList.remove('hidden'); 
            } else {
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
            const ctGroup = document.getElementById('group-encaminhamento_ct');
            const fieldsets = ctGroup ? ctGroup.querySelectorAll('fieldset') : [];
            const ctSendSection = fieldsets.length > 0 ? fieldsets[0] : null;
            const ctFeedbackSection = fieldsets.length > 1 ? fieldsets[1] : null;
            const hasSentCT = !!(data?.ctSentDate);
            if (isEditing && hasSentCT) {
                ctSendSection.classList.add('hidden');
                ctFeedbackSection.classList.remove('hidden');
                document.getElementById('ct-feedback').required = true;
                document.querySelectorAll('input[name="ct-returned"]').forEach(r => r.required = true);
            } else {
                ctSendSection.classList.remove('hidden');
                ctFeedbackSection.classList.add('hidden');
                document.getElementById('ct-sent-date').required = true;
                document.getElementById('oficio-number').required = true;
                document.getElementById('oficio-year').required = true;
                if(!isEditing) document.getElementById('oficio-year').value = new Date().getFullYear();
            }
            break;
        case 'analise':
            document.getElementById('ct-parecer').required = true;
            break;
    }

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
                if (currentActionDateInput) currentActionDateInput.min = minDateString;
                 if (finalActionType.startsWith('tentativa')) {
                     const contactDateInput = document.getElementById('contact-date');
                     if (contactDateInput) contactDateInput.min = minDateString;
                 }
            } catch (e) { console.error("Erro ao calcular data mínima:", e); }
        }
    }

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
                break;
            case 'analise':
                document.getElementById('ct-parecer').value = data.ctParecer || '';
                break;
        }
    } else { 
        toggleFamilyContactFields(false, document.getElementById('family-contact-fields'));
        toggleVisitContactFields(false, document.getElementById('visit-contact-fields'));
        document.querySelectorAll('input[name="contact-succeeded"], input[name="visit-succeeded"], input[name="contact-returned"], input[name="visit-returned"], input[name="ct-returned"]').forEach(r => r.checked = false);
    }
    if (preFilledData) {
        if (finalActionType.startsWith('tentativa') && preFilledData.succeeded) {
            const radio = document.querySelector(`input[name="contact-succeeded"][value="${preFilledData.succeeded}"]`);
            if (radio) { radio.checked = true; toggleFamilyContactFields(preFilledData.succeeded === 'yes', document.getElementById('family-contact-fields')); }
        } else if (finalActionType === 'visita' && preFilledData.succeeded) {
            const radio = document.querySelector(`input[name="visit-succeeded"][value="${preFilledData.succeeded}"]`);
            if (radio) { radio.checked = true; toggleVisitContactFields(preFilledData.succeeded === 'yes', document.getElementById('visit-contact-fields')); }
        }
    }
    openModal(dom.absenceModal);
};

async function handleAbsenceSubmit(e) {
    e.preventDefault(); 
    const form = e.target;
    let firstInvalidField = null;
    form.querySelectorAll('input:not([disabled]), select:not([disabled]), textarea:not([disabled])').forEach(el => {
        if (el.type === 'file') return; 
        if (el.offsetParent === null) return; 
        if (el.required && !el.value && el.type !== 'radio') {
             if (!firstInvalidField) firstInvalidField = el;
        }
         if (el.type === 'radio' && el.required) {
             const groupName = el.name;
             const group = form.querySelectorAll(`input[name="${groupName}"]:not([disabled])`);
             const isGroupChecked = Array.from(group).some(radio => radio.checked);
             if (!isGroupChecked && !firstInvalidField) firstInvalidField = group[0];
         }
    });
    if (firstInvalidField) {
         showAlert(`Por favor, preencha o campo obrigatório: ${firstInvalidField.labels?.[0]?.textContent || firstInvalidField.name || firstInvalidField.placeholder || 'Campo Requerido'}`);
         firstInvalidField.focus();
         return;
    }
    const actionType = document.getElementById('action-type').value;
    if (actionType.startsWith('tentativa')) {
        if (!document.getElementById('family-contact-section').classList.contains('hidden')) {
            const contactSucceededRadio = form.querySelector('input[name="contact-succeeded"]:checked');
            if (!contactSucceededRadio) return showAlert("Por favor, informe se conseguiu contato (Sim/Não).");
            const contactReturnedRadio = form.querySelector('input[name="contact-returned"]:checked');
            if (!contactReturnedRadio) return showAlert("Por favor, informe se o aluno retornou.");
        }
    }
    const data = getAbsenceFormData();
    if (!data) return; 
    if (pendingAbsenceImagesBase64.length > 0) data.contactPrints = pendingAbsenceImagesBase64;
    const id = data.id; 
    if (id) {
        const existingAction = state.absences.find(a => a.id === id);
        if (existingAction) {
            for (const key in data) {
                if (data[key] === null && existingAction[key] != null) {
                    if (key !== 'contactPrints') data[key] = existingAction[key];
                }
            }
            if (pendingAbsenceImagesBase64.length === 0) {
                if(existingAction.contactPrints) data.contactPrints = existingAction.contactPrints;
                else if(existingAction.contactPrint) data.contactPrints = [existingAction.contactPrint]; 
            }
        }
    }
    const { currentCycleActions } = getStudentProcessInfo(data.studentId);
    const dateCheck = validateAbsenceChronology(currentCycleActions, data);
    if (!dateCheck.isValid) return showAlert(dateCheck.message);
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
             if (student) generateAndShowOficio(data, data.oficioNumber);
        }
        const studentReturned = (data.contactReturned === 'yes' || data.visitReturned === 'yes' || data.ctReturned === 'yes');
        if (studentReturned && data.actionType !== 'analise') {
            const student = state.students.find(s => s.matricula === data.studentId);
             setTimeout(() => {
                 const { currentCycleActions: updatedActions } = getStudentProcessInfo(data.studentId); 
                 if (student && !updatedActions.some(a => a.actionType === 'analise')) openAbsenceModalForStudent(student, 'analise'); 
             }, 400); 
        }
    } catch (error) {
        console.error("Erro ao salvar ação de BA:", error);
        showAlert('Erro ao salvar ação.');
    }
}
function getAbsenceFormData() {
    const studentId = dom.absenceForm.dataset.selectedStudentId;
    if (!studentId) { showAlert("Erro: Aluno não identificado."); return null; }
    const studentName = document.getElementById('absence-student-name').value;
    const studentClass = document.getElementById('absence-student-class').value;
    const data = {
        id: document.getElementById('absence-id').value, 
        studentId: studentId, studentName: studentName, studentClass: studentClass, 
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

function handleViewOficio(id) {
    const ctAction = state.absences.find(a => a.id === id);
    if (ctAction && ctAction.oficioNumber) generateAndShowOficio(ctAction, ctAction.oficioNumber); 
    else showAlert("Registro de encaminhamento ou número do ofício não encontrado.");
}
async function handleNewAbsenceFromHistory(studentId) {
    let student = state.students.find(s => s.matricula === studentId);
    if (!student) {
        showToast("A carregar dados do aluno...");
        try { student = await getStudentById(studentId); } catch (error) { console.error("Erro ao buscar aluno:", error); }
    }
    if (student) handleNewAbsenceAction(student); 
    else showAlert("Erro: Aluno não encontrado no sistema.");
}
async function handleQuickFeedbackAbsence(id, actionType, value) {
    const action = state.absences.find(a => a.id === id);
    if (!action) return showAlert("Ação não encontrada.");
    let student = state.students.find(s => s.matricula === action.studentId);
    if (!student) {
        try { student = await getStudentById(action.studentId); } catch (error) { console.error(error); }
    }
    if (student) openAbsenceModalForStudent(student, actionType, action, { succeeded: value });
    else showAlert("Dados do aluno não encontrados.");
}
function handleEditAbsence(id) {
    const data = state.absences.find(a => a.id === id);
    if (!data) return showAlert("Ação não encontrada.");
    const processActions = state.absences.filter(a => a.processId === data.processId).sort((a, b) => { const dateA = getActionMainDate(a) || a.createdAt?.seconds || 0; const dateB = getActionMainDate(b) || b.createdAt?.seconds || 0; return dateA - dateB; });
    const lastProcessAction = processActions.length > 0 ? processActions[processActions.length - 1] : null;
    const isConcluded = processActions.some(a => a.actionType === 'analise');
    if (isConcluded || !lastProcessAction || data.id !== lastProcessAction.id) return showAlert(isConcluded ? "Processo concluído, não pode editar." : "Apenas a última ação pode ser editada.");
    let student = state.students.find(s => s.matricula === data.studentId);
    if (!student) student = { matricula: data.studentId, name: data.studentName || `Aluno (${data.studentId})`, class: data.studentClass || '', endereco: '', contato: '' };
    if (student) openAbsenceModalForStudent(student, data.actionType, data); 
}
function handleDeleteAbsence(id) {
    const actionToDelete = state.absences.find(a => a.id === id);
    if (!actionToDelete) return;
    const processActions = state.absences.filter(a => a.processId === actionToDelete.processId).sort((a, b) => { const dateA = getActionMainDate(a) || a.createdAt?.seconds || 0; const dateB = getActionMainDate(b) || b.createdAt?.seconds || 0; return dateA - dateB; });
    const lastProcessAction = processActions.length > 0 ? processActions[processActions.length - 1] : null;
    const isConcluded = processActions.some(a => a.actionType === 'analise');
    if (isConcluded || !lastProcessAction || actionToDelete.id !== lastProcessAction.id) return showAlert(isConcluded ? "Processo concluído, não pode excluir." : "Apenas a última ação pode ser excluída.");
    document.getElementById('delete-confirm-message').textContent = 'Tem certeza que deseja Limpar esta ação? Esta ação não pode ser desfeita.';
    state.recordToDelete = { type: 'absence', id: id };
    openModal(dom.deleteConfirmModal);
}

export const initAbsenceListeners = () => {
    window.viewImage = (img, title) => openImageModal(img, title);
    if (dom.addAbsenceBtn) dom.addAbsenceBtn.addEventListener('click', openAbsenceSearchFlowModal);
    if (dom.searchAbsences) dom.searchAbsences.addEventListener('input', (e) => { state.filterAbsences = e.target.value; document.getElementById('absence-student-suggestions').classList.add('hidden'); renderAbsences(); });
    if (dom.generalBaReportBtn) dom.generalBaReportBtn.addEventListener('click', generateAndShowBuscaAtivaReport);
    document.getElementById('filter-process-status').addEventListener('change', (e) => { state.filtersAbsences.processStatus = e.target.value; renderAbsences(); });
    document.getElementById('filter-pending-action').addEventListener('change', (e) => { state.filtersAbsences.pendingAction = e.target.value; renderAbsences(); });
    document.getElementById('filter-return-status').addEventListener('change', (e) => { state.filtersAbsences.returnStatus = e.target.value; renderAbsences(); });
    document.getElementById('absence-start-date-filter').addEventListener('change', (e) => { state.filtersAbsences.startDate = e.target.value; renderAbsences(); });
    document.getElementById('absence-end-date-filter').addEventListener('change', (e) => { state.filtersAbsences.endDate = e.target.value; renderAbsences(); });
    if (dom.absenceForm) dom.absenceForm.addEventListener('submit', handleAbsenceSubmit);
    
    const absenceFileInput = document.getElementById('absence-contact-print');
    if (absenceFileInput) {
        absenceFileInput.addEventListener('change', async (e) => {
            const files = e.target.files;
            if (!files || files.length === 0) return;
            document.getElementById('absence-print-label').textContent = 'Processando...';
            try {
                for (let i = 0; i < files.length; i++) {
                    const compressedBase64 = await compressImage(files[i]);
                    pendingAbsenceImagesBase64.push(compressedBase64);
                }
                document.getElementById('absence-print-label').textContent = `${pendingAbsenceImagesBase64.length} Imagens`;
                document.getElementById('absence-print-check').classList.remove('hidden');
                renderImagePreviews('absence-print-preview');
            } catch (err) {
                console.error("Erro ao processar imagem:", err);
                showAlert("Erro ao processar uma ou mais imagens.");
                document.getElementById('absence-print-label').textContent = 'Erro';
            }
            absenceFileInput.value = '';
        });
    }

    document.querySelectorAll('input[name="contact-succeeded"]').forEach(radio => radio.addEventListener('change', (e) => toggleFamilyContactFields(e.target.value === 'yes', document.getElementById('family-contact-fields'))));
    document.querySelectorAll('input[name="visit-succeeded"]').forEach(radio => radio.addEventListener('change', (e) => toggleVisitContactFields(e.target.value === 'yes', document.getElementById('visit-contact-fields'))));

    dom.absencesListDiv.addEventListener('click', (e) => {
        const button = e.target.closest('button');
        if (button) {
            e.stopPropagation(); 
            if (button.closest('.process-content')) {
                const id = button.dataset.id; 
                if (button.classList.contains('view-notification-btn-hist')) { if (id) openFichaViewModal(id); else showAlert("ID da notificação não encontrado."); return; }
                if (button.classList.contains('view-oficio-btn-hist')) { if (id) handleViewOficio(id); return; }
                if (button.classList.contains('quick-feedback-ba-btn')) { handleQuickFeedbackAbsence(id, button.dataset.actionType, button.dataset.value); return; }
                if (button.classList.contains('avancar-etapa-btn') && !button.disabled) { handleNewAbsenceFromHistory(button.dataset.studentId); return; }
                if (button.classList.contains('edit-absence-action-btn') && !button.disabled) { handleEditAbsence(id); return; }
                if (button.classList.contains('reset-absence-action-btn') && !button.disabled) { handleDeleteAbsence(id); return; }
            }
            if (button.classList.contains('generate-ficha-btn-row')) { generateAndShowConsolidatedFicha(button.dataset.studentId, button.dataset.processId); return; }
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
