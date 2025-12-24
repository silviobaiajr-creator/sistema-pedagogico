
// =================================================================================
// ARQUIVO: absence.js 
// VERSÃO: 6.3 (Com Upload para Firebase Storage e Multimídia)

import { state, dom } from './state.js';
import { showToast, showAlert, openModal, closeModal, formatDate, formatTime, getStatusBadge, openImageModal, uploadToStorage } from './utils.js';
import { getStudentProcessInfo, determineNextActionForStudent, validateAbsenceChronology } from './logic.js';
import { actionDisplayTitles, openFichaViewModal, generateAndShowConsolidatedFicha, generateAndShowOficio, openAbsenceHistoryModal, generateAndShowBuscaAtivaReport } from './reports.js';
import { updateRecordWithHistory, addRecordWithHistory, deleteRecord, getCollectionRef, searchStudentsByName, getStudentById, findDocumentSnapshot } from './firestore.js';
import { doc, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from './firebase.js';


// --- Funções Auxiliares ---

// Lista de ARQUIVOS BRUTOS (não mais Base64)
let pendingAbsenceFiles = [];

const normalizeText = (text) => {
    if (!text) return '';
    return text.toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
};

// ... (getActionMainDate e getDateInputForActionType mantidos) ...
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
// FUNÇÃO AUXILIAR: RENDERIZAR PREVIEW DE ARQUIVOS (LOCAL)
// =================================================================================

const renderFilePreviews = (containerId) => {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';

    if (pendingAbsenceFiles.length === 0) {
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');
    container.className = "flex flex-wrap gap-2 mt-2";

    pendingAbsenceFiles.forEach((file, index) => {
        const wrapper = document.createElement('div');
        wrapper.className = "relative group w-16 h-16 border rounded bg-gray-100 overflow-hidden";

        let mediaElement;
        const objectUrl = URL.createObjectURL(file);

        if (file.type.startsWith('image/')) {
            mediaElement = document.createElement('img');
            mediaElement.src = objectUrl;
            mediaElement.className = "w-full h-full object-cover cursor-pointer";
            mediaElement.onclick = () => window.viewImage(objectUrl, file.name);
        } else if (file.type.startsWith('video/')) {
            mediaElement = document.createElement('div');
            mediaElement.className = "w-full h-full flex items-center justify-center bg-black text-white cursor-pointer";
            mediaElement.innerHTML = '<i class="fas fa-video"></i>';
            mediaElement.onclick = () => window.viewImage(objectUrl, file.name);
        } else if (file.type.startsWith('audio/')) {
            mediaElement = document.createElement('div');
            mediaElement.className = "w-full h-full flex items-center justify-center bg-purple-600 text-white cursor-pointer";
            mediaElement.innerHTML = '<i class="fas fa-music"></i>';
            mediaElement.onclick = () => window.viewImage(objectUrl, file.name);
        }

        const removeBtn = document.createElement('button');
        removeBtn.className = "absolute top-0 right-0 bg-red-500 text-white text-xs w-5 h-5 flex items-center justify-center opacity-80 hover:opacity-100 z-10";
        removeBtn.innerHTML = "&times;";
        removeBtn.type = "button";
        removeBtn.onclick = (e) => {
            e.stopPropagation();
            pendingAbsenceFiles.splice(index, 1);

            const labelEl = document.getElementById('absence-print-label');
            if (labelEl) labelEl.textContent = pendingAbsenceFiles.length > 0 ? `${pendingAbsenceFiles.length} Arq.` : 'Selecionar';

            const checkEl = document.getElementById('absence-print-check');
            if (checkEl && pendingAbsenceFiles.length === 0) checkEl.classList.add('hidden');

            renderFilePreviews(containerId);
        };

        wrapper.appendChild(mediaElement);
        wrapper.appendChild(removeBtn);
        container.appendChild(wrapper);
    });
};

// ... (openAbsenceSearchFlowModal, setupAbsenceSearchFlowAutocomplete mantidos) ...
let absenceSearchTimeout = null;

// NOVO: Helper para popular classes (duplicado para isolamento ou poderia ser compartilhado)
const populateAbsenceClassSelect = () => {
    const select = document.getElementById('absence-class-filter');
    if (!select) return;

    const classes = new Set();
    state.students.forEach(s => { if (s.class) classes.add(s.class); });
    state.occurrences.forEach(o => {
        o.participantsInvolved?.forEach(p => { if (p.student?.class) classes.add(p.student.class); });
    });
    state.absences.forEach(a => { if (a.studentClass) classes.add(a.studentClass); });

    const sortedClasses = Array.from(classes).sort();
    const currentVal = select.value;

    select.innerHTML = '<option value="">Todas as Turmas</option>';
    sortedClasses.forEach(cls => {
        const option = document.createElement('option');
        option.value = cls;
        option.textContent = cls;
        select.appendChild(option);
    });
    select.value = currentVal;
};

export const openAbsenceSearchFlowModal = () => {
    const input = document.getElementById('absence-search-flow-input');
    const suggestionsContainer = document.getElementById('absence-search-flow-suggestions');
    const resultsContainer = document.getElementById('absence-search-flow-results');

    input.value = '';
    suggestionsContainer.innerHTML = '';
    suggestionsContainer.classList.add('hidden');
    resultsContainer.innerHTML = '<p class="text-sm text-gray-400 text-center">Comece a digitar o nome do aluno acima.</p>';

    populateAbsenceClassSelect(); // NOVO: Popula turmas
    setupAbsenceSearchFlowAutocomplete(input, suggestionsContainer);

    const closeBtn = document.getElementById('close-absence-search-flow-modal-btn');
    const cancelBtn = document.getElementById('cancel-absence-search-flow-btn');
    if (closeBtn) closeBtn.onclick = () => closeModal(dom.absenceSearchFlowModal);
    if (cancelBtn) cancelBtn.onclick = () => closeModal(dom.absenceSearchFlowModal);

    openModal(dom.absenceSearchFlowModal);
};

const setupAbsenceSearchFlowAutocomplete = (input, suggestionsContainer) => {
    const classSelect = document.getElementById('absence-class-filter');

    // NOVO: Handler de mudança de turma
    if (classSelect) {
        classSelect.addEventListener('change', () => {
            input.value = '';
            suggestionsContainer.classList.add('hidden');
        });
    }

    input.addEventListener('input', () => {
        const rawValue = input.value;
        const selectedClass = classSelect ? classSelect.value : '';

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

                let filteredResults = results;

                // NOVO: Filtragem por Classe
                if (selectedClass) {
                    filteredResults = filteredResults.filter(s => s.class === selectedClass);
                }

                if (filteredResults.length > 0) {
                    filteredResults.forEach(student => {
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
                    const msg = selectedClass ? 'Nenhum aluno encontrado nesta turma.' : 'Nenhum aluno encontrado.';
                    suggestionsContainer.innerHTML = `<div class="p-2 text-gray-500 text-xs">${msg}</div>`;
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

// ... (renderAbsences e helpers associados mantidos, apenas ajustes menores de UI se precisar) ...
const getTimeSinceUpdate = (dateString) => {
    if (!dateString) return { text: 'Novo', days: 0 };
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays <= 1) return { text: 'Hoje', days: 0 };
    return { text: `${diffDays}d parado`, days: diffDays };
};

const getNextActionDisplay = (actionType) => {
    const titles = {
        'tentativa_1': '1ª Tentativa', 'tentativa_2': '2ª Tentativa', 'tentativa_3': '3ª Tentativa',
        'visita': 'Visita', 'encaminhamento_ct': 'Conselho T.', 'analise': 'Finalizar'
    };
    return titles[actionType] || 'Próxima';
};

const getUrgencyBorderClass = (isConcluded, didNotReturn, stalledDays) => {
    if (isConcluded) return 'border-emerald-500'; // Sucesso/Fim
    if (didNotReturn) return 'border-red-600';    // Crítico (Não retornou)
    if (stalledDays > 7) return 'border-orange-500'; // Crítico (Parado muito tempo)
    if (stalledDays > 4) return 'border-yellow-500'; // Atenção
    return 'border-sky-500'; // Normal
};

const getActionIcon = (type) => {
    if (type.startsWith('tentativa')) return 'fa-phone-alt';
    if (type === 'visita') return 'fa-home';
    if (type === 'encaminhamento_ct') return 'fa-landmark';
    if (type === 'analise') return 'fa-clipboard-check';
    return 'fa-circle';
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
        const actions = groupedByProcess[processId];
        if (!actions || actions.length === 0) return false;

        actions.sort((a, b) => {
            const timeA = (a.createdAt?.seconds || new Date(a.createdAt).getTime());
            const timeB = (b.createdAt?.seconds || new Date(b.createdAt).getTime());
            return timeA - timeB;
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

            const isConcludedA = actionsA.some(action => action.actionType === 'analise');
            const isConcludedB = actionsB.some(action => action.actionType === 'analise');

            if (isConcludedA !== isConcludedB) {
                return isConcludedA ? 1 : -1;
            }

            const lastActionA = actionsA[actionsA.length - 1];
            const lastActionB = actionsB[actionsB.length - 1];

            const timeA = lastActionA.createdAt?.seconds || 0;
            const timeB = lastActionB.createdAt?.seconds || 0;

            return timeB - timeA;
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

            const lastUpdateDate = lastProcessAction.createdAt?.toDate ? lastProcessAction.createdAt.toDate() : (new Date(lastProcessAction.createdAt) || new Date());
            const { text: timeText, days: stalledDays } = getTimeSinceUpdate(lastUpdateDate);

            const lastReturnAction = [...actions].reverse().find(a => a.contactReturned != null || a.visitReturned != null || a.ctReturned != null);
            const didNotReturn = lastReturnAction && (lastReturnAction.contactReturned === 'no' || lastReturnAction.visitReturned === 'no' || lastReturnAction.ctReturned === 'no');

            const borderClass = getUrgencyBorderClass(isConcluded, didNotReturn, stalledDays);

            let timeBadgeColor = 'bg-gray-100 text-gray-600';
            if (stalledDays > 7 && !isConcluded) timeBadgeColor = 'bg-red-100 text-red-800 font-bold';
            else if (stalledDays > 3 && !isConcluded) timeBadgeColor = 'bg-orange-100 text-orange-800';

            const nextActionType = determineNextActionForStudent(firstAction.studentId);
            const nextActionText = isConcluded ? "Finalizado" : `Ir para: ${getNextActionDisplay(nextActionType)}`;

            let historyHtml = '';

            actions.forEach(abs => {
                const actionDisplayDate = getActionMainDate(abs) || (abs.createdAt?.toDate() ? abs.createdAt.toDate().toISOString().split('T')[0] : '');
                const returned = abs.contactReturned === 'yes' || abs.visitReturned === 'yes' || abs.ctReturned === 'yes';
                const notReturned = abs.contactReturned === 'no' || abs.visitReturned === 'no' || abs.ctReturned === 'no';

                let statusHtml = '';
                let showQuickButtons = false;

                if (abs.actionType.startsWith('tentativa')) {
                    if (abs.contactSucceeded === 'yes') statusHtml = `<span class="text-green-600 font-bold text-xs"><i class="fas fa-check"></i> Contato OK</span>`;
                    else if (abs.contactSucceeded === 'no') statusHtml = `<span class="text-red-600 font-bold text-xs"><i class="fas fa-times"></i> Sem Contato</span>`;
                    else if (abs.meetingDate) { statusHtml = `<span class="text-yellow-600 font-medium text-xs"><i class="fas fa-clock"></i> Aguardando</span>`; showQuickButtons = true; }
                    else statusHtml = `<span class="text-blue-600 font-medium text-xs">Agendando...</span>`;
                } else if (abs.actionType === 'visita') {
                    if (abs.visitSucceeded === 'yes') statusHtml = `<span class="text-green-600 font-bold text-xs"><i class="fas fa-check"></i> Visita OK</span>`;
                    else if (abs.visitSucceeded === 'no') statusHtml = `<span class="text-red-600 font-bold text-xs"><i class="fas fa-times"></i> Falhou</span>`;
                    else { statusHtml = `<span class="text-yellow-600 font-medium text-xs">Pendente</span>`; showQuickButtons = true; }
                } else if (abs.actionType === 'encaminhamento_ct') {
                    if (abs.ctFeedback) statusHtml = `<span class="text-purple-600 font-bold text-xs"><i class="fas fa-reply"></i> Respondido</span>`;
                    else if (abs.ctSentDate) statusHtml = `<span class="text-yellow-600 font-medium text-xs">Enviado</span>`;
                } else if (abs.actionType === 'analise') {
                    statusHtml = `<span class="text-green-700 font-bold text-xs">Concluído</span>`;
                }

                let viewButtonHtml = '';
                if (abs.actionType.startsWith('tentativa') && abs.meetingDate && abs.meetingTime) viewButtonHtml = `<button type="button" class="view-notification-btn-hist text-sky-600 hover:text-sky-800 ml-2" data-id="${abs.id}" title="Ver Notificação"><i class="fas fa-eye"></i></button>`;
                if (abs.actionType === 'encaminhamento_ct' && abs.oficioNumber) viewButtonHtml = `<button type="button" class="view-oficio-btn-hist text-green-600 hover:text-green-800 ml-2" data-id="${abs.id}" title="Ver Ofício"><i class="fas fa-file-alt"></i></button>`;

                let imagesToShow = [];
                if (abs.contactPrints && Array.isArray(abs.contactPrints) && abs.contactPrints.length > 0) imagesToShow = abs.contactPrints;
                else if (abs.contactPrint) imagesToShow = [abs.contactPrint];
                if (imagesToShow.length > 0) {
                    const btnLabel = imagesToShow.length > 1 ? `[${imagesToShow.length} Anexos]` : `[Anexo]`;
                    viewButtonHtml += `<button type="button" class="text-purple-600 hover:text-purple-800 text-xs font-semibold ml-2 cursor-pointer" onclick="window.viewImage('${imagesToShow[0]}', 'Anexo')"><i class="fas fa-paperclip"></i> ${btnLabel}</button>`;
                }

                const iconClass = getActionIcon(abs.actionType);

                historyHtml += `
                    <div class="flex items-center justify-between mb-2 pb-2 border-b border-gray-100 last:border-0 last:pb-0">
                        <div class="flex items-center gap-2 overflow-hidden">
                            <div class="w-6 text-center text-gray-400"><i class="fas ${iconClass}"></i></div>
                            <div class="flex flex-col">
                                <span class="text-xs font-semibold text-gray-700">${actionDisplayTitles[abs.actionType]}</span>
                                <span class="text-[10px] text-gray-400">${formatDate(actionDisplayDate)}</span>
                            </div>
                        </div>
                        <div class="flex items-center gap-2">
                            ${statusHtml}
                            ${returned ? '<span class="text-[10px] bg-green-100 text-green-800 px-1 rounded">Retornou</span>' : ''}
                            ${notReturned ? '<span class="text-[10px] bg-red-100 text-red-800 px-1 rounded">Não Retornou</span>' : ''}
                            ${viewButtonHtml}
                        </div>
                    </div>
                    ${showQuickButtons ? `
                        <div class="ml-8 mb-2 flex items-center gap-2">
                            <span class="text-[10px] text-gray-500 uppercase tracking-wide">Registro Rápido:</span>
                            <button type="button" class="quick-feedback-ba-btn bg-green-50 text-green-700 hover:bg-green-100 text-xs px-2 py-0.5 rounded border border-green-200 transition" data-id="${abs.id}" data-student-id="${firstAction.studentId}" data-action-type="${abs.actionType}" data-value="yes">Sim</button>
                            <button type="button" class="quick-feedback-ba-btn bg-red-50 text-red-700 hover:bg-red-100 text-xs px-2 py-0.5 rounded border border-red-200 transition" data-id="${abs.id}" data-student-id="${firstAction.studentId}" data-action-type="${abs.actionType}" data-value="no">Não</button>
                        </div>
                    ` : ''}
                `;
            });

            const disableEditDelete = isConcluded || !lastProcessAction;

            const avancarBtn = `<button type="button" class="avancar-etapa-btn flex-1 bg-sky-600 text-white hover:bg-sky-700 text-xs font-semibold py-2 px-2 rounded transition shadow-sm ${isConcluded ? 'opacity-50 cursor-not-allowed' : ''}" ${isConcluded ? 'disabled' : ''} data-student-id="${firstAction.studentId}"><i class="fas fa-forward mr-1"></i> ${nextActionText}</button>`;
            const editBtn = `<button type="button" class="edit-absence-action-btn bg-gray-100 text-gray-600 hover:bg-gray-200 text-xs font-semibold py-2 px-3 rounded transition ${disableEditDelete ? 'opacity-50 cursor-not-allowed' : ''}" ${disableEditDelete ? 'disabled' : ''} data-id="${lastProcessAction.id}" title="Editar"><i class="fas fa-pencil-alt"></i></button>`;
            const limparBtn = `<button type="button" class="reset-absence-action-btn bg-gray-100 text-red-500 hover:bg-red-50 text-xs font-semibold py-2 px-3 rounded transition ${disableEditDelete ? 'opacity-50 cursor-not-allowed' : ''}" ${disableEditDelete ? 'disabled' : ''} data-id="${lastProcessAction.id}" title="Excluir"><i class="fas fa-trash"></i></button>`;

            const contentId = `ba-content-${processId}`;

            html += `
                <div class="border-l-4 ${borderClass} rounded-lg bg-white shadow-sm mb-4 transition hover:shadow-md">
                    <div class="process-header cursor-pointer p-4" data-content-id="${contentId}">
                        <div class="flex justify-between items-start">
                            <div>
                                <h3 class="font-bold text-gray-800 text-lg">${studentName}</h3>
                                <p class="text-xs text-gray-500 font-medium uppercase tracking-wide mt-0.5">${studentClass} • Início: ${formatDate(firstAction.createdAt?.toDate())}</p>
                            </div>
                            <div class="flex flex-col items-end gap-1">
                                <span class="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${isConcluded ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}">${isConcluded ? 'Concluído' : 'Em Andamento'}</span>
                                <span class="text-xs px-2 py-0.5 rounded-full ${timeBadgeColor} border border-gray-200 flex items-center gap-1"><i class="far fa-clock"></i> ${timeText}</span>
                            </div>
                        </div>
                        
                        <div class="mt-3 flex justify-between items-end">
                            <div class="text-xs text-gray-500">
                                <span class="font-semibold text-gray-700">Última ação:</span> ${actionDisplayTitles[lastProcessAction.actionType]}
                            </div>
                            <div class="flex items-center text-gray-400 text-xs">
                                <span class="mr-1">Detalhes</span> <i class="fas fa-chevron-down transition-transform duration-300"></i>
                            </div>
                        </div>
                    </div>
                    
                    <div class="process-content bg-gray-50 border-t border-gray-100" id="${contentId}" style="max-height: 0px; overflow: hidden;">
                        <div class="p-4">
                             <div class="space-y-1 mb-4 bg-white p-3 rounded border border-gray-200 shadow-sm">
                                ${historyHtml}
                             </div>
                             
                             <div class="flex items-center gap-2 mt-2">
                                <button class="generate-ficha-btn-row bg-teal-600 text-white font-bold py-2 px-3 rounded hover:bg-teal-700 text-xs shadow-sm" data-student-id="${firstAction.studentId}" data-process-id="${processId}" title="Gerar Ficha"><i class="fas fa-file-invoice"></i></button>
                                ${editBtn}
                                ${limparBtn}
                                ${avancarBtn}
                             </div>
                        </div>
                    </div>
                </div>
            `;
        }
        dom.absencesListDiv.innerHTML = html;
    }
};

export const handleNewAbsenceAction = async (student) => {
    // ... (Mantido igual)
    const { currentCycleActions } = getStudentProcessInfo(student.matricula);
    currentCycleActions.sort((a, b) => {
        const dateA = getActionMainDate(a) || a.createdAt?.seconds || 0;
        const dateB = getActionMainDate(b) || b.createdAt?.seconds || 0;
        const timeA = typeof dateA === 'string' ? new Date(dateA + 'T00:00:00Z').getTime() : (dateA instanceof Date ? dateA.getTime() : (dateA || 0) * 1000);
        const timeB = typeof dateB === 'string' ? new Date(dateB + 'T00:00:00Z').getTime() : (dateB instanceof Date ? dateB.getTime() : (dateB || 0) * 1000);
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
            // ---------------------------------------------------------------------
            // BLOQUEIO BUSCA ATIVA (Tentativa X -> Feedback)
            // ---------------------------------------------------------------------
            if (lastAction.actionType.startsWith('tentativa') && lastAction.meetingDate) {
                // Se tem agendamento, mas vai registrar feedback (isPending), checa assinatura na notificacao
                const docSnapshot = await findDocumentSnapshot('notificacao', student.matricula, lastAction.id);
                // Validação Estrita de Assinatura
                let isSigned = false;
                if (docSnapshot && docSnapshot.signatures) {
                    const requiredKey = `responsible_${student.matricula}`;
                    isSigned = !!docSnapshot.signatures[requiredKey]; // Verifica existência (objeto ou true)
                }

                if (!isSigned) {
                    await showAlert(`Ação Bloqueada: A Notificação desta tentativa não foi assinada pelo responsável (Aluno: ${student.name}).\n\nÉ obrigatória a assinatura do responsável para registrar o feedback.`);
                    return;
                }
            }
            // ---------------------------------------------------------------------

            showAlert(pendingActionMessage);
            openAbsenceModalForStudent(student, lastAction.actionType, lastAction);
            return;
        }
    }
    const nextActionType = determineNextActionForStudent(student.matricula);
    if (nextActionType) openAbsenceModalForStudent(student, nextActionType);
    else showAlert("Processo já concluído ou em etapa final.");
};

export const toggleFamilyContactFields = (enable, fieldsContainer) => {
    if (!fieldsContainer) return;
    fieldsContainer.classList.toggle('hidden', !enable);
    const detailFields = fieldsContainer.querySelectorAll('input, textarea, select');
    const returnedRadioGroup = document.querySelectorAll('input[name="contact-returned"]');
    detailFields.forEach(input => {
        if (input.type === 'file') return;
        input.disabled = !enable; input.required = enable;
        if (!enable) { input.classList.add('bg-gray-200', 'cursor-not-allowed'); input.value = ''; }
        else input.classList.remove('bg-gray-200', 'cursor-not-allowed');
    });
    returnedRadioGroup.forEach(radio => { radio.required = false; radio.disabled = false; if (!enable) radio.checked = false; });
};

export const toggleVisitContactFields = (enable, fieldsContainer) => {
    if (!fieldsContainer) return;
    fieldsContainer.classList.toggle('hidden', !enable);
    const detailFields = fieldsContainer.querySelectorAll('input[type="text"], textarea');
    const returnedRadioGroup = document.querySelectorAll('input[name="visit-returned"]');
    detailFields.forEach(input => {
        input.disabled = !enable; input.required = enable;
        if (!enable) { input.classList.add('bg-gray-200', 'cursor-not-allowed'); input.value = ''; }
        else input.classList.remove('bg-gray-200', 'cursor-not-allowed');
    });
    returnedRadioGroup.forEach(radio => radio.required = enable);
};

export const openAbsenceModalForStudent = async (student, forceActionType = null, data = null, preFilledData = null) => {
    // -------------------------------------------------------------------------
    // BLOQUEIO PARCIAL: Se assinado, bloqueia dados do agendamento, mas libera feedback
    // -------------------------------------------------------------------------
    const finalActionTypeCheck = forceActionType || (data ? data.actionType : null);
    let isLockedBySignature = false;

    if (data && data.id && finalActionTypeCheck && finalActionTypeCheck.startsWith('tentativa')) {
        const docSnapshot = await findDocumentSnapshot('notificacao', student.matricula, data.id);
        if (docSnapshot && docSnapshot.signatures) {
            const isSigned = Object.keys(docSnapshot.signatures).some(k => k.startsWith('responsible_'));
            if (isSigned) {
                isLockedBySignature = true;
                showToast("Aviso: Dados da tentativa bloqueados p/ edição (Documento Assinado). Apenas o feedback pode ser alterado.");
            }
        }
    }
    // -------------------------------------------------------------------------
    dom.absenceForm.reset();

    // Reseta arquivos
    pendingAbsenceFiles = [];
    document.getElementById('absence-print-label').textContent = 'Selecionar Arquivos';
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

    // ... (restante do setup do modal mantido)
    ['meeting-date', 'contact-date', 'visit-date', 'ct-sent-date'].forEach(id => {
        const input = document.getElementById(id); if (input) input.removeAttribute('min');
    });
    dom.absenceForm.querySelectorAll('[required]').forEach(el => el.required = false);
    document.querySelectorAll('.dynamic-field-group').forEach(group => group.classList.add('hidden'));

    const statusDisplay = document.getElementById('absence-status-display');
    const finalActionType = forceActionType || (data ? data.actionType : determineNextActionForStudent(student.matricula));

    let statusText = 'Em Andamento';
    let statusColor = 'bg-blue-100 text-blue-800';
    if (finalActionType === 'analise') { statusText = 'Aguardando Análise BAE'; statusColor = 'bg-purple-100 text-purple-800'; }
    else if (finalActionType.startsWith('tentativa')) statusText = `Tentativa ${finalActionType.split('_')[1]}`;
    else if (finalActionType === 'encaminhamento_ct') statusText = 'Encaminhamento CT';
    else if (finalActionType === 'visita') statusText = 'Visita Domiciliar';

    if (statusDisplay) statusDisplay.innerHTML = `<strong>Etapa:</strong> <span class="text-xs font-medium px-2.5 py-0.5 rounded-full ${statusColor} ml-2">${statusText}</span>`;

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

    if (isFirstStep) { if (studentIdentityBlock) studentIdentityBlock.classList.remove('hidden'); absencePeriodData.classList.remove('hidden'); }
    else { if (studentIdentityBlock) studentIdentityBlock.classList.add('hidden'); absencePeriodData.classList.add('hidden'); }

    const absenceInputs = absencePeriodData.querySelectorAll('input');
    const shouldRequireAbsenceData = isAbsenceDataEditable && !absencePeriodData.classList.contains('hidden');
    document.getElementById('absence-start-date').required = shouldRequireAbsenceData;
    document.getElementById('absence-end-date').required = shouldRequireAbsenceData;
    document.getElementById('absence-count').required = shouldRequireAbsenceData;

    if (isAbsenceDataEditable) { absenceInputs.forEach(input => { input.readOnly = false; input.classList.remove('bg-gray-100'); }); }
    else {
        const sourceData = isEditing && data.actionType === 'tentativa_1' ? data : firstAbsenceRecordInCycle;
        document.getElementById('absence-start-date').value = sourceData?.periodoFaltasStart || '';
        document.getElementById('absence-end-date').value = sourceData?.periodoFaltasEnd || '';
        document.getElementById('absence-count').value = sourceData?.absenceCount || '';
        absenceInputs.forEach(input => { input.readOnly = true; input.classList.add('bg-gray-100'); });
    }

    const groupElement = document.getElementById(finalActionType.startsWith('tentativa') ? 'group-tentativas' : `group-${finalActionType}`);
    if (groupElement) groupElement.classList.remove('hidden');
    const printContainer = document.getElementById('absence-print-container');
    if (printContainer) printContainer.classList.add('hidden');

    switch (finalActionType) {
        case 'tentativa_1': case 'tentativa_2': case 'tentativa_3':
            const convocationSection = document.getElementById('convocation-section');
            const familyContactSection = document.getElementById('family-contact-section');
            const hasConvocation = !!(data?.meetingDate);
            const isContactStep = isEditing && hasConvocation && data.contactSucceeded == null;
            if ((isEditing && isContactStep) || (hasConvocation && !isEditing) || (isEditing && hasConvocation)) {
                convocationSection.classList.add('hidden'); familyContactSection.classList.remove('hidden');
                document.querySelectorAll('input[name="contact-succeeded"]').forEach(r => r.required = true);
                document.querySelectorAll('input[name="contact-returned"]').forEach(r => r.required = false);
                if (printContainer) printContainer.classList.remove('hidden');
            } else {
                convocationSection.classList.remove('hidden'); familyContactSection.classList.add('hidden');
                document.getElementById('meeting-date').required = true; document.getElementById('meeting-time').required = true;
            }
            break;
        case 'visita':
            document.getElementById('visit-agent').required = true; document.getElementById('visit-date').required = true;
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
                ctSendSection.classList.add('hidden'); ctFeedbackSection.classList.remove('hidden');
                document.getElementById('ct-feedback').required = true;
                document.querySelectorAll('input[name="ct-returned"]').forEach(r => r.required = true);
            } else {
                ctSendSection.classList.remove('hidden'); ctFeedbackSection.classList.add('hidden');
                document.getElementById('ct-sent-date').required = true; document.getElementById('oficio-number').required = true;
                document.getElementById('oficio-year').required = true;
                if (!isEditing) document.getElementById('oficio-year').value = new Date().getFullYear();
            }
            break;
        case 'analise': document.getElementById('ct-parecer').required = true; break;
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
                if (contactSucceededRadio) { contactSucceededRadio.checked = true; toggleFamilyContactFields(data.contactSucceeded === 'yes', document.getElementById('family-contact-fields')); }
                else { document.querySelectorAll(`input[name="contact-succeeded"]`).forEach(r => r.checked = false); toggleFamilyContactFields(false, document.getElementById('family-contact-fields')); }
                document.getElementById('absence-contact-type').value = data.contactType || '';
                document.getElementById('contact-date').value = data.contactDate || '';
                document.getElementById('contact-person').value = data.contactPerson || '';
                document.getElementById('contact-reason').value = data.contactReason || '';
                const contactReturnedRadio = document.querySelector(`input[name="contact-returned"][value="${data.contactReturned}"]`);
                if (contactReturnedRadio) contactReturnedRadio.checked = true;
                else document.querySelectorAll(`input[name="contact-returned"]`).forEach(r => r.checked = false);
                break;
            case 'visita':
                document.getElementById('visit-agent').value = data.visitAgent || '';
                document.getElementById('visit-date').value = data.visitDate || '';
                const visitSucceededRadio = document.querySelector(`input[name="visit-succeeded"][value="${data.visitSucceeded}"]`);
                if (visitSucceededRadio) { visitSucceededRadio.checked = true; toggleVisitContactFields(data.visitSucceeded === 'yes', document.getElementById('visit-contact-fields')); }
                else { document.querySelectorAll(`input[name="visit-succeeded"]`).forEach(r => r.checked = false); toggleVisitContactFields(false, document.getElementById('visit-contact-fields')); }
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
            case 'analise': document.getElementById('ct-parecer').value = data.ctParecer || ''; break;
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

    if (isLockedBySignature) {
        ['meeting-date', 'meeting-time', 'visit-date', 'visit-agent'].forEach(fid => {
            const el = document.getElementById(fid);
            if (el) {
                el.disabled = true;
                el.classList.add('bg-gray-100', 'cursor-not-allowed');
                el.title = "Campo bloqueado pois existe um documento assinado vinculado.";
            }
        });
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
        if (el.required && !el.value && el.type !== 'radio') { if (!firstInvalidField) firstInvalidField = el; }
        if (el.type === 'radio' && el.required) {
            const groupName = el.name;
            const group = form.querySelectorAll(`input[name="${groupName}"]:not([disabled])`);
            const isGroupChecked = Array.from(group).some(radio => radio.checked);
            if (!isGroupChecked && !firstInvalidField) firstInvalidField = group[0];
        }
    });
    if (firstInvalidField) { showAlert(`Por favor, preencha o campo obrigatório: ${firstInvalidField.labels?.[0]?.textContent || firstInvalidField.name || firstInvalidField.placeholder || 'Campo Requerido'}`); firstInvalidField.focus(); return; }

    const actionType = document.getElementById('action-type').value;
    if (actionType.startsWith('tentativa')) {
        if (!document.getElementById('family-contact-section').classList.contains('hidden')) {
            const contactSucceededRadio = form.querySelector('input[name="contact-succeeded"]:checked');
            if (!contactSucceededRadio) { showAlert("Por favor, informe se conseguiu contato (Sim/Não)."); return; }
            const contactReturnedRadio = form.querySelector('input[name="contact-returned"]:checked');
            if (!contactReturnedRadio) { showAlert("Por favor, informe se o aluno retornou."); return; }
        }
    }

    // --- UPLOAD ASSÍNCRONO DE ARQUIVOS ---
    const submitBtn = form.querySelector('button[type="submit"]');
    const originalBtnText = submitBtn.innerText;
    let uploadedUrls = [];

    if (pendingAbsenceFiles.length > 0) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Enviando arquivos...`;

        try {
            const uploadPromises = pendingAbsenceFiles.map(file => uploadToStorage(file, 'absences'));
            uploadedUrls = await Promise.all(uploadPromises);
        } catch (uploadError) {
            submitBtn.disabled = false;
            submitBtn.innerText = originalBtnText;
            return showAlert("Erro ao enviar anexos. Tente novamente.");
        }
    }
    // -------------------------------------

    const data = getAbsenceFormData();
    if (!data) {
        submitBtn.disabled = false;
        submitBtn.innerText = originalBtnText;
        return;
    }

    // Salva URLs em vez de base64
    if (uploadedUrls.length > 0) {
        data.contactPrints = uploadedUrls;
    }

    const id = data.id;
    // ... (lógica de mesclagem mantida para updates parciais se necessário)
    if (id) {
        const existingAction = state.absences.find(a => a.id === id);
        if (existingAction) {
            for (const key in data) {
                if (data[key] === null && existingAction[key] != null) { if (key !== 'contactPrints') { data[key] = existingAction[key]; } }
            }
            // Se não subiu novos, mantém os antigos
            if (uploadedUrls.length === 0) {
                if (existingAction.contactPrints) data.contactPrints = existingAction.contactPrints;
                else if (existingAction.contactPrint) data.contactPrints = [existingAction.contactPrint];
            }
        }
    }

    const { currentCycleActions } = getStudentProcessInfo(data.studentId);
    const dateCheck = validateAbsenceChronology(currentCycleActions, data);
    if (!dateCheck.isValid) {
        submitBtn.disabled = false;
        submitBtn.innerText = originalBtnText;
        return showAlert(dateCheck.message);
    }

    try {
        const historyAction = id ? "Dados da ação atualizados." : `Ação de Busca Ativa registada (${actionDisplayTitles[data.actionType]}).`;
        if (id) { const updateData = { ...data }; delete updateData.id; await updateRecordWithHistory('absence', id, updateData, historyAction, state.userEmail); }
        else { const addData = { ...data }; delete addData.id; await addRecordWithHistory('absence', addData, historyAction, state.userEmail); }

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
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerText = originalBtnText;
    }
}

// ... (Restante do arquivo inalterado)
function getAbsenceFormData() {
    // ... (código existente)
    const studentId = dom.absenceForm.dataset.selectedStudentId;
    if (!studentId) { showAlert("Erro: Aluno não identificado."); return null; }
    const studentName = document.getElementById('absence-student-name').value;
    const studentClass = document.getElementById('absence-student-class').value;
    const data = {
        id: document.getElementById('absence-id').value, studentId: studentId, studentName: studentName, studentClass: studentClass, actionType: document.getElementById('action-type').value, processId: document.getElementById('absence-process-id').value,
        periodoFaltasStart: document.getElementById('absence-start-date').readOnly ? null : document.getElementById('absence-start-date').value || null,
        periodoFaltasEnd: document.getElementById('absence-end-date').readOnly ? null : document.getElementById('absence-end-date').value || null,
        absenceCount: document.getElementById('absence-count').readOnly ? null : document.getElementById('absence-count').value || null,
        meetingDate: null, meetingTime: null, contactSucceeded: null, contactType: null, contactDate: null, contactPerson: null, contactReason: null, contactReturned: null,
        visitAgent: null, visitDate: null, visitSucceeded: null, visitContactPerson: null, visitReason: null, visitObs: null, visitReturned: null,
        ctSentDate: null, ctFeedback: null, ctReturned: null, oficioNumber: null, oficioYear: null, ctParecer: null
    };

    const actionType = data.actionType;
    if (actionType.startsWith('tentativa')) {
        if (!document.getElementById('convocation-section').classList.contains('hidden')) { data.meetingDate = document.getElementById('meeting-date').value || null; data.meetingTime = document.getElementById('meeting-time').value || null; }
        if (!document.getElementById('family-contact-section').classList.contains('hidden')) {
            const contactSucceededRadio = document.querySelector('input[name="contact-succeeded"]:checked');
            data.contactSucceeded = contactSucceededRadio ? contactSucceededRadio.value : null;
            if (data.contactSucceeded === 'yes') { data.contactType = document.getElementById('absence-contact-type').value || null; data.contactDate = document.getElementById('contact-date').value || null; data.contactPerson = document.getElementById('contact-person').value.trim() || null; data.contactReason = document.getElementById('contact-reason').value.trim() || null; }
            const contactReturnedRadio = document.querySelector('input[name="contact-returned"]:checked');
            data.contactReturned = contactReturnedRadio ? contactReturnedRadio.value : null;
        }
    } else if (actionType === 'visita') {
        data.visitAgent = document.getElementById('visit-agent').value.trim() || null; data.visitDate = document.getElementById('visit-date').value || null;
        const visitSucceededRadio = document.querySelector('input[name="visit-succeeded"]:checked');
        data.visitSucceeded = visitSucceededRadio ? visitSucceededRadio.value : null;
        if (data.visitSucceeded === 'yes') { data.visitContactPerson = document.getElementById('visit-contact-person').value.trim() || null; data.visitReason = document.getElementById('visit-reason').value.trim() || null; data.visitObs = document.getElementById('visit-obs').value.trim() || null; }
        const visitReturnedRadio = document.querySelector('input[name="visit-returned"]:checked');
        data.visitReturned = visitReturnedRadio ? visitReturnedRadio.value : null;
    } else if (actionType === 'encaminhamento_ct') {
        const hasCtSentData = document.getElementById('ct-sent-date').required;
        const hasCtFeedbackData = document.getElementById('ct-feedback').required;
        if (hasCtSentData) { data.ctSentDate = document.getElementById('ct-sent-date').value || null; data.oficioNumber = document.getElementById('oficio-number').value.trim() || null; data.oficioYear = document.getElementById('oficio-year').value.trim() || null; }
        if (hasCtFeedbackData) { data.ctFeedback = document.getElementById('ct-feedback').value.trim() || null; const ctReturnedRadio = document.querySelector('input[name="ct-returned"]:checked'); data.ctReturned = ctReturnedRadio ? ctReturnedRadio.value : null; }
    } else if (actionType === 'analise') { data.ctParecer = document.getElementById('ct-parecer').value.trim() || null; }
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
    if (student) handleNewAbsenceAction(student); else showAlert("Erro: Aluno não encontrado no sistema.");
}

async function handleQuickFeedbackAbsence(id, actionType, value) {
    const action = state.absences.find(a => a.id === id);
    if (!action) return showAlert("Ação não encontrada.");
    let student = state.students.find(s => s.matricula === action.studentId);
    if (!student) { try { student = await getStudentById(action.studentId); } catch (error) { console.error(error); } }

    // ---------------------------------------------------------------------
    // BLOQUEIO RÁPIDO (Busca Ativa)
    // ---------------------------------------------------------------------
    if (student && actionType.startsWith('tentativa')) {
        const docSnapshot = await findDocumentSnapshot('notificacao', student.matricula, id);
        let isSigned = false;
        if (docSnapshot && docSnapshot.signatures) {
            isSigned = Object.keys(docSnapshot.signatures).some(k => k.startsWith('responsible_'));
        }
        if (!isSigned) {
            return showAlert("Ação Bloqueada: É obrigatório que a notificação esteja assinada pelo responsável antes de registrar o feedback.");
        }
    }
    // ---------------------------------------------------------------------

    if (student) openAbsenceModalForStudent(student, actionType, action, { succeeded: value }); else showAlert("Dados do aluno não encontrados.");
}

function handleEditAbsence(id) {
    const data = state.absences.find(a => a.id === id);
    if (!data) return showAlert("Ação não encontrada.");
    const processActions = state.absences.filter(a => a.processId === data.processId).sort((a, b) => {
        const dateA = getActionMainDate(a) || a.createdAt?.seconds || 0; const dateB = getActionMainDate(b) || b.createdAt?.seconds || 0;
        const timeA = typeof dateA === 'string' ? new Date(dateA + 'T00:00:00Z').getTime() : (dateA instanceof Date ? dateA.getTime() : (dateA || 0) * 1000);
        const timeB = typeof dateB === 'string' ? new Date(dateB + 'T00:00:00Z').getTime() : (dateB instanceof Date ? dateB.getTime() : (dateB || 0) * 1000);
        if (timeA === timeB) { const createA = a.createdAt?.seconds || (a.createdAt instanceof Date ? a.createdAt.getTime() / 1000 : 0); const createB = b.createdAt?.seconds || (b.createdAt instanceof Date ? b.createdAt.getTime() / 1000 : 0); return (createA || 0) - (createB || 0); }
        return (timeA || 0) - (timeB || 0);
    });
    const lastProcessAction = processActions[processActions.length - 1];
    const isConcluded = processActions.some(a => a.actionType === 'analise');
    if (isConcluded || data.id !== lastProcessAction?.id) return showAlert(isConcluded ? "Processo concluído, não pode editar." : "Apenas a última ação pode ser editada.");
    let student = state.students.find(s => s.matricula === data.studentId);
    if (!student) { student = { matricula: data.studentId, name: data.studentName || `Aluno (${data.studentId})`, class: data.studentClass || '', endereco: '', contato: '' }; }
    if (student) openAbsenceModalForStudent(student, data.actionType, data);
}

async function handleDeleteAbsence(id) {
    const actionToDelete = state.absences.find(a => a.id === id);
    if (!actionToDelete) return;
    const processActions = state.absences.filter(a => a.processId === actionToDelete.processId).sort((a, b) => {
        const dateA = getActionMainDate(a) || a.createdAt?.seconds || 0; const dateB = getActionMainDate(b) || b.createdAt?.seconds || 0;
        const timeA = typeof dateA === 'string' ? new Date(dateA + 'T00:00:00Z').getTime() : (dateA instanceof Date ? dateA.getTime() : (dateA || 0) * 1000);
        const timeB = typeof dateB === 'string' ? new Date(dateB + 'T00:00:00Z').getTime() : (dateB instanceof Date ? dateB.getTime() : (dateB || 0) * 1000);
        if (timeA === timeB) { const createA = a.createdAt?.seconds || (a.createdAt instanceof Date ? a.createdAt.getTime() / 1000 : 0); const createB = b.createdAt?.seconds || (b.createdAt instanceof Date ? b.createdAt.getTime() / 1000 : 0); return (createA || 0) - (createB || 0); }
        return (timeA || 0) - (timeB || 0);
    });
    const lastProcessAction = processActions.length > 0 ? processActions[processActions.length - 1] : null;
    const isConcluded = processActions.some(a => a.actionType === 'analise');
    if (isConcluded || !lastProcessAction || actionToDelete.id !== lastProcessAction.id) return showAlert(isConcluded ? "Processo concluído, não pode excluir." : "Apenas a última ação pode ser excluída.");

    // -------------------------------------------------------------------------
    // BLOQUEIO DE EXCLUSÃO: Verificar se já existe Ata Assinada (Busca Ativa)
    // -------------------------------------------------------------------------
    if (lastProcessAction.actionType.startsWith('tentativa')) {
        const docSnapshot = await findDocumentSnapshot('notificacao', actionToDelete.studentId, lastProcessAction.id);
        if (docSnapshot && docSnapshot.signatures) {
            const isSigned = Object.keys(docSnapshot.signatures).some(k => k.startsWith('responsible_'));
            if (isSigned) {
                return showAlert(`Ação Bloqueada: Esta tentativa possui uma Notificação Assinada.\n\nPara excluir esta etapa, você deve primeiro cancelar/invalidar o documento assinado.`);
            }
        }
    }
    // -------------------------------------------------------------------------
    document.getElementById('delete-confirm-message').textContent = 'Tem certeza que deseja Limpar esta ação? Esta ação não pode ser desfeita.';
    state.recordToDelete = { type: 'absence', id: id };
    openModal(dom.deleteConfirmModal);
}

export const initAbsenceListeners = () => {
    window.viewImage = (img, title) => openImageModal(img, title);
    if (dom.addAbsenceBtn) dom.addAbsenceBtn.addEventListener('click', openAbsenceSearchFlowModal);
    if (dom.searchAbsences) { dom.searchAbsences.addEventListener('input', (e) => { state.filterAbsences = e.target.value; document.getElementById('absence-student-suggestions').classList.add('hidden'); renderAbsences(); }); }
    if (dom.generalBaReportBtn) dom.generalBaReportBtn.addEventListener('click', generateAndShowBuscaAtivaReport);
    document.getElementById('filter-process-status').addEventListener('change', (e) => { state.filtersAbsences.processStatus = e.target.value; renderAbsences(); });
    document.getElementById('filter-pending-action').addEventListener('change', (e) => { state.filtersAbsences.pendingAction = e.target.value; renderAbsences(); });
    document.getElementById('filter-return-status').addEventListener('change', (e) => { state.filtersAbsences.returnStatus = e.target.value; renderAbsences(); });
    document.getElementById('absence-start-date-filter').addEventListener('change', (e) => { state.filtersAbsences.startDate = e.target.value; renderAbsences(); });
    document.getElementById('absence-end-date-filter').addEventListener('change', (e) => { state.filtersAbsences.endDate = e.target.value; renderAbsences(); });
    if (dom.absenceForm) dom.absenceForm.addEventListener('submit', handleAbsenceSubmit);

    // LISTENER DE UPLOAD (ATUALIZADO)
    const absenceFileInput = document.getElementById('absence-contact-print');
    if (absenceFileInput) {
        absenceFileInput.addEventListener('change', async (e) => {
            const files = e.target.files; if (!files || files.length === 0) return;
            // Armazena File Objects
            for (let i = 0; i < files.length; i++) {
                pendingAbsenceFiles.push(files[i]);
            }
            document.getElementById('absence-print-label').textContent = `${pendingAbsenceFiles.length} Arq.`;
            document.getElementById('absence-print-check').classList.remove('hidden');
            renderFilePreviews('absence-print-preview');
            absenceFileInput.value = '';
        });
    }

    document.querySelectorAll('input[name="contact-succeeded"]').forEach(radio => radio.addEventListener('change', (e) => toggleFamilyContactFields(e.target.value === 'yes', document.getElementById('family-contact-fields'))));
    document.querySelectorAll('input[name="visit-succeeded"]').forEach(radio => radio.addEventListener('change', (e) => toggleVisitContactFields(e.target.value === 'yes', document.getElementById('visit-contact-fields'))));

    dom.absencesListDiv.addEventListener('click', (e) => {
        // ... (Listener inalterado)
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
            const contentId = header.dataset.contentId; const content = document.getElementById(contentId); const icon = header.querySelector('i.fa-chevron-down');
            if (content) { const isHidden = !content.style.maxHeight || content.style.maxHeight === '0px'; if (isHidden) { content.style.maxHeight = `${content.scrollHeight}px`; content.style.overflow = 'visible'; } else { content.style.maxHeight = null; setTimeout(() => content.style.overflow = 'hidden', 300); } icon?.classList.toggle('rotate-180', isHidden); }
            return;
        }
    });
};
