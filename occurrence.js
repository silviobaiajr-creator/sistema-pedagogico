
// =================================================================================
// ARQUIVO: occurrence.js 
// VERSÃO: 6.3 (Correção Preview Arquivos + Fallback)

import { state, dom } from './state.js';
import { showToast, showAlert, openModal, closeModal, getStatusBadge, formatDate, formatTime, openImageModal, uploadToStorage } from './utils.js';
import {
    getCollectionRef,
    getCounterDocRef,
    updateRecordWithHistory,
    addRecordWithHistory,
    deleteRecord,
    getIncidentByGroupId as fetchIncidentById,
    searchStudentsByName
} from './firestore.js';
import {
    determineNextOccurrenceStep,
    determineCurrentActionFromStatus,
    occurrenceStepLogic,
    roleIcons,
    defaultRole,
    getFilteredOccurrences,
    validateOccurrenceChronology
} from './logic.js';
import {
    openOccurrenceRecordModal,
    openHistoryModal,
    generateAndShowGeneralReport,
    generateAndShowOccurrenceOficio,
    openIndividualNotificationModal
} from './reports.js';
import { writeBatch, doc, collection, query, where, getDocs, runTransaction } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from './firebase.js';

const occurrenceActionTitles = {
    'convocacao_1': 'Ação 2: 1ª Convocação',
    'feedback_1': 'Ação 3: Feedback da 1ª Tentativa',
    'convocacao_2': 'Ação 2: 2ª Convocação',
    'feedback_2': 'Ação 3: Feedback da 2ª Tentativa',
    'convocacao_3': 'Ação 2: 3ª Convocação',
    'feedback_3': 'Ação 3: Feedback da 3ª Tentativa',
    'desfecho_ou_ct': 'Ação 4 ou 6: Encaminhar ao CT ou Dar Parecer',
    'devolutiva_ct': 'Ação 5: Registrar Devolutiva do CT',
    'parecer_final': 'Ação 6: Dar Parecer Final'
};

const nextStepLabels = {
    'convocacao_1': 'Agendar 1ª Conv.',
    'feedback_1': 'Reg. Contato',
    'convocacao_2': 'Agendar 2ª Conv.',
    'feedback_2': 'Reg. Contato (2ª)',
    'convocacao_3': 'Agendar 3ª Conv.',
    'feedback_3': 'Reg. Contato (3ª)',
    'desfecho_ou_ct': 'Definir Desfecho',
    'devolutiva_ct': 'Reg. Devolutiva',
    'parecer_final': 'Finalizar'
};

let studentPendingRoleSelection = null;
let editingRoleId = null;
let studentSearchTimeout = null;
let pendingFiles = [];

const normalizeText = (text) => {
    if (!text) return '';
    return text.toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
};

const renderTags = () => {
    const tagsContainerElement = document.getElementById('student-tags-container');
    tagsContainerElement.innerHTML = '';

    if (state.selectedStudents.size === 0) {
        tagsContainerElement.innerHTML = `<p class="text-sm text-gray-400">Pesquise e selecione um ou mais alunos...</p>`;
        return;
    }

    state.selectedStudents.forEach((data, studentId) => {
        const { student, role } = data;
        const tag = document.createElement('span');
        tag.className = 'bg-sky-100 text-sky-800 text-sm font-medium me-2 px-2.5 py-1 rounded-full flex items-center gap-1.5';
        const iconClass = roleIcons[role] || roleIcons[defaultRole];

        tag.innerHTML = `
            <i class="${iconClass} fa-fw" title="${role}"></i>
            <span>${student.name}</span>
            <span class="text-xs text-sky-500 font-normal">(${student.class || 'S/ Turma'})</span>
            <button type="button" class="edit-role-btn ml-1 text-gray-400 hover:text-sky-600" data-id="${studentId}" title="Editar Papel">
                <i class="fas fa-pencil-alt fa-xs"></i>
            </button>
            <button type="button" class="remove-tag-btn ms-1 text-sky-600 hover:text-sky-800">&times;</button>
        `;

        tag.querySelector('.remove-tag-btn').addEventListener('click', () => {
            state.selectedStudents.delete(studentId);
            renderTags();
        });

        tag.querySelector('.edit-role-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            openRoleEditDropdown(e.currentTarget, studentId);
        });

        tagsContainerElement.appendChild(tag);
    });
};

const openRoleEditDropdown = (buttonElement, studentId) => {
    const dropdown = document.getElementById('role-edit-dropdown');
    editingRoleId = studentId;

    const rect = buttonElement.getBoundingClientRect();
    dropdown.style.top = `${rect.bottom + window.scrollY}px`;
    dropdown.style.left = `${rect.left + window.scrollX}px`;
    dropdown.classList.remove('hidden');

    const closeListener = (e) => {
        if (!dropdown.contains(e.target) && e.target !== buttonElement) {
            dropdown.classList.add('hidden');
            document.removeEventListener('click', closeListener);
            editingRoleId = null;
        }
    };
    setTimeout(() => document.addEventListener('click', closeListener), 0);
};

export const setupStudentTagInput = (inputElement, suggestionsElement, tagsContainerElement) => {
    const roleSelectionPanel = document.getElementById('role-selection-panel');
    const roleSelectionStudentName = document.getElementById('role-selection-student-name');
    const roleSelectButtons = roleSelectionPanel.querySelectorAll('.role-select-btn');
    const roleEditDropdown = document.getElementById('role-edit-dropdown');
    const roleEditOptions = roleEditDropdown.querySelectorAll('.role-edit-option');

    studentPendingRoleSelection = null;
    roleSelectionPanel.classList.add('hidden');
    roleEditDropdown.classList.add('hidden');

    inputElement.addEventListener('input', () => {
        const value = inputElement.value;
        const normalizedValue = normalizeText(value);

        suggestionsElement.innerHTML = '';
        roleSelectionPanel.classList.add('hidden');
        studentPendingRoleSelection = null;

        if (!normalizedValue) {
            suggestionsElement.classList.add('hidden');
            return;
        }

        if (studentSearchTimeout) clearTimeout(studentSearchTimeout);

        studentSearchTimeout = setTimeout(async () => {
            suggestionsElement.classList.remove('hidden');
            suggestionsElement.innerHTML = '<div class="p-2 text-gray-500 text-xs"><i class="fas fa-spinner fa-spin"></i> Buscando no servidor...</div>';

            try {
                const results = await searchStudentsByName(value);
                suggestionsElement.innerHTML = '';

                const filteredResults = results.filter(s => !state.selectedStudents.has(s.matricula));

                if (filteredResults.length > 0) {
                    filteredResults.forEach(student => {
                        const item = document.createElement('div');
                        item.className = 'suggestion-item p-2 cursor-pointer hover:bg-sky-50 border-b border-gray-100';
                        item.innerHTML = `<span class="font-semibold text-gray-800">${student.name}</span> <span class="text-xs text-gray-500">(${student.class || 'S/ Turma'})</span>`;

                        item.addEventListener('click', () => {
                            if (!state.students.find(s => s.matricula === student.matricula)) {
                                state.students.push(student);
                            }

                            studentPendingRoleSelection = student;
                            roleSelectionStudentName.textContent = student.name;
                            roleSelectionPanel.classList.remove('hidden');
                            suggestionsElement.classList.add('hidden');
                            inputElement.value = '';
                            inputElement.focus();
                        });
                        suggestionsElement.appendChild(item);
                    });
                } else {
                    suggestionsElement.innerHTML = '<div class="p-2 text-gray-500 text-xs">Nenhum aluno encontrado.</div>';
                }
            } catch (error) {
                console.error("Erro na busca de alunos:", error);
                suggestionsElement.innerHTML = '<div class="p-2 text-red-500 text-xs">Erro na busca.</div>';
            }
        }, 400);
    });

    roleSelectButtons.forEach(button => {
        button.addEventListener('click', () => {
            if (studentPendingRoleSelection) {
                const selectedRole = button.dataset.role;
                state.selectedStudents.set(studentPendingRoleSelection.matricula, {
                    student: studentPendingRoleSelection,
                    role: selectedRole
                });
                studentPendingRoleSelection = null;
                roleSelectionPanel.classList.add('hidden');
                renderTags();
            }
        });
    });

    roleEditOptions.forEach(option => {
        option.addEventListener('click', () => {
            if (editingRoleId && state.selectedStudents.has(editingRoleId)) {
                const newRole = option.dataset.role;
                const currentData = state.selectedStudents.get(editingRoleId);
                currentData.role = newRole;
                state.selectedStudents.set(editingRoleId, currentData);
                roleEditDropdown.classList.add('hidden');
                renderTags();
                editingRoleId = null;
            }
        });
    });

    document.addEventListener('click', (e) => {
        if (!suggestionsElement.contains(e.target) && e.target !== inputElement) {
            suggestionsElement.classList.add('hidden');
        }
        if (!roleSelectionPanel.contains(e.target) && !e.target.closest('.suggestion-item')) {
            roleSelectionPanel.classList.add('hidden');
            studentPendingRoleSelection = null;
        }
    });

    renderTags();
};

// FUNÇÃO ATUALIZADA PARA RENDERIZAR PREVIEW CORRETAMENTE
const renderFilePreviews = (containerId) => {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';

    if (pendingFiles.length === 0) {
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');
    container.className = "flex flex-wrap gap-2 mt-2";

    pendingFiles.forEach((file, index) => {
        const wrapper = document.createElement('div');
        wrapper.className = "relative group w-16 h-16 border rounded bg-gray-100 overflow-hidden";

        let mediaElement = document.createElement('div');
        mediaElement.className = "w-full h-full flex items-center justify-center bg-gray-200 text-gray-500 cursor-pointer";
        const objectUrl = URL.createObjectURL(file);

        if (file.type.startsWith('image/')) {
            mediaElement = document.createElement('img');
            mediaElement.src = objectUrl;
            mediaElement.className = "w-full h-full object-cover cursor-pointer";
            mediaElement.onclick = () => window.viewImage(objectUrl, file.name);
        } else if (file.type.startsWith('video/')) {
            mediaElement.className = "w-full h-full flex items-center justify-center bg-black text-white cursor-pointer";
            mediaElement.innerHTML = '<i class="fas fa-video"></i>';
            mediaElement.onclick = () => window.viewImage(objectUrl, file.name);
        } else if (file.type.startsWith('audio/')) {
            mediaElement.className = "w-full h-full flex items-center justify-center bg-purple-600 text-white cursor-pointer";
            mediaElement.innerHTML = '<i class="fas fa-music"></i>';
            mediaElement.onclick = () => window.viewImage(objectUrl, file.name);
        } else {
            // Fallback para arquivos genéricos
            mediaElement.innerHTML = '<i class="fas fa-file-alt"></i>';
            mediaElement.title = file.name;
        }

        const removeBtn = document.createElement('button');
        removeBtn.className = "absolute top-0 right-0 bg-red-500 text-white text-xs w-5 h-5 flex items-center justify-center opacity-80 hover:opacity-100 z-10";
        removeBtn.innerHTML = "&times;";
        removeBtn.type = "button";
        removeBtn.onclick = (e) => {
            e.stopPropagation();
            pendingFiles.splice(index, 1);

            const labelEl = document.getElementById(containerId.replace('-preview', '-label'));
            if (labelEl) labelEl.textContent = pendingFiles.length > 0 ? `${pendingFiles.length} Arq.` : 'Selecionar';

            const checkEl = document.getElementById(containerId.replace('-preview', '-check'));
            if (checkEl && pendingFiles.length === 0) checkEl.classList.add('hidden');

            renderFilePreviews(containerId);
        };

        wrapper.appendChild(mediaElement);
        wrapper.appendChild(removeBtn);
        container.appendChild(wrapper);
    });
};

const getTypeColorClass = (type) => {
    if (!type) return 'border-gray-200';
    const lowerType = type.toLowerCase();
    if (lowerType.includes('agressão') || lowerType.includes('bullying')) return 'border-red-500';
    if (lowerType.includes('indisciplina') || lowerType.includes('comportamento') || lowerType.includes('telemóvel')) return 'border-yellow-500';
    if (lowerType.includes('dano')) return 'border-orange-500';
    return 'border-sky-500';
};

const getStepIndicator = (status) => {
    const steps = {
        'Aguardando Convocação 1': { text: 'Passo 1/6', color: 'bg-blue-100 text-blue-700' },
        'Aguardando Feedback 1': { text: 'Passo 2/6', color: 'bg-blue-100 text-blue-700' },
        'Aguardando Convocação 2': { text: 'Passo 3/6', color: 'bg-indigo-100 text-indigo-700' },
        'Aguardando Feedback 2': { text: 'Passo 4/6', color: 'bg-indigo-100 text-indigo-700' },
        'Aguardando Convocação 3': { text: 'Passo 5/6', color: 'bg-purple-100 text-purple-700' },
        'Aguardando Desfecho': { text: 'Passo 5/6', color: 'bg-purple-100 text-purple-700' },
        'Aguardando Devolutiva CT': { text: 'Passo 6/6', color: 'bg-pink-100 text-pink-700' },
        'Aguardando Parecer Final': { text: 'Finalizando', color: 'bg-pink-100 text-pink-700' },
        'Resolvido': { text: 'Concluído', color: 'bg-green-100 text-green-700' },
        'Finalizada': { text: 'Concluído', color: 'bg-green-100 text-green-700' }
    };
    return steps[status] || { text: 'Início', color: 'bg-gray-100 text-gray-700' };
};

const getTimeSinceUpdate = (dateString, updateDate) => {
    const refDate = updateDate ? (updateDate.toDate ? updateDate.toDate() : new Date(updateDate)) : new Date();
    const now = new Date();
    const diffTime = Math.abs(now - refDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    let color = 'text-gray-400';
    if (diffDays > 7) color = 'text-red-500 font-bold';
    else if (diffDays > 4) color = 'text-orange-500';

    if (diffDays <= 1) return { text: 'Hoje', class: 'text-green-600' };
    return { text: `${diffDays}d parado`, class: color };
};

export const renderOccurrences = () => {
    dom.loadingOccurrences.classList.add('hidden');
    const filteredIncidents = getFilteredOccurrences();
    dom.occurrencesTitle.textContent = `Exibindo ${filteredIncidents.size} Incidente(s)`;

    if (filteredIncidents.size === 0) {
        dom.emptyStateOccurrences.classList.remove('hidden');
        dom.occurrencesListDiv.innerHTML = '';
        return;
    }
    dom.emptyStateOccurrences.classList.add('hidden');

    const sortedIncidents = [...filteredIncidents.values()].sort((a, b) =>
        (b.records && b.records.length > 0 ? new Date(b.records[0].date) : 0) -
        (a.records && a.records.length > 0 ? new Date(a.records[0].date) : 0)
    );

    let html = sortedIncidents.map(incident => {
        const mainRecord = incident.records && incident.records.length > 0 ? incident.records[0] : null;
        if (!mainRecord) return '';

        const studentSearch = normalizeText(state.filterOccurrences);
        const isFinalizada = incident.overallStatus === 'Finalizada';
        const borderColorClass = getTypeColorClass(mainRecord.occurrenceType);

        const studentAccordionsHTML = [...incident.participantsInvolved.values()]
            .filter(participant => {
                if (studentSearch && !normalizeText(participant.student.name).includes(studentSearch)) return false;
                return true;
            })
            .map(participant => {
                const { student, role } = participant;
                if (!student) return '';
                const record = incident.records.find(r => r && r.studentId === student.matricula);
                const recordId = record?.id || '';
                const status = record?.statusIndividual || 'Aguardando Convocação';

                const isMatch = studentSearch && normalizeText(student.name).includes(studentSearch);
                const iconClass = roleIcons[role] || roleIcons[defaultRole];
                const isIndividualResolvido = record?.statusIndividual === 'Resolvido';

                const stepInfo = getStepIndicator(status);
                const timeInfo = getTimeSinceUpdate(null, record?.updatedAt || record?.createdAt);

                const nextStepKey = determineNextOccurrenceStep(status);
                const nextActionText = nextStepLabels[nextStepKey] || 'Avançar / Agendar';

                let historyHtml = '';

                const renderAttemptBlock = (index, mDate, mTime, succeeded, contactDate, contactPerson, contactPrints, legacyContactPrint) => {
                    if (!mDate) return '';
                    const attemptNum = index;
                    const notificationBtn = `
                        <button type="button" class="view-notification-btn-hist text-sky-600 hover:text-sky-800 ml-2" 
                                data-record-id="${recordId}" data-student-id="${student.matricula}" data-group-id="${incident.id}" data-attempt="${attemptNum}" title="Ver Notificação">
                            <i class="fas fa-eye"></i>
                        </button>`;

                    let statusContent = '';
                    let statusIcon = '<i class="fas fa-bullhorn text-gray-400"></i>';

                    if (succeeded === null) {
                        statusContent = `
                            <div class="mt-1 flex items-center gap-2 ml-7">
                                <span class="text-[10px] text-yellow-700 font-medium uppercase">Registro Rápido:</span>
                                <button type="button" class="quick-feedback-btn bg-green-50 text-green-700 hover:bg-green-100 text-xs px-2 py-0.5 rounded border border-green-200 transition"
                                        data-record-id="${recordId}" data-student-id="${student.matricula}" data-group-id="${incident.id}" data-action="feedback_${attemptNum}" data-value="yes">Sim</button>
                                <button type="button" class="quick-feedback-btn bg-red-50 text-red-700 hover:bg-red-100 text-xs px-2 py-0.5 rounded border border-red-200 transition"
                                        data-record-id="${recordId}" data-student-id="${student.matricula}" data-group-id="${incident.id}" data-action="feedback_${attemptNum}" data-value="no">Não</button>
                            </div>`;
                    } else if (succeeded === 'yes') {
                        let printsHtml = '';
                        let imagesToShow = [];
                        if (contactPrints && Array.isArray(contactPrints) && contactPrints.length > 0) imagesToShow = contactPrints;
                        else if (legacyContactPrint) imagesToShow = [legacyContactPrint];

                        if (imagesToShow.length > 0) {
                            const btnLabel = imagesToShow.length > 1 ? `[${imagesToShow.length} Anexos]` : `[Anexo]`;
                            printsHtml = `<button type="button" class="view-print-btn text-purple-600 hover:text-purple-800 text-xs font-semibold ml-2 cursor-pointer" onclick="window.viewImage('${imagesToShow[0]}', 'Anexo')"><i class="fas fa-paperclip"></i> ${btnLabel}</button>`;
                        }
                        statusContent = `<div class="ml-7 text-xs"><span class="text-green-600 font-bold"><i class="fas fa-check"></i> Contato OK</span> <span class="text-gray-500">(${contactPerson || 'Resp.'} em ${formatDate(contactDate)})</span> ${printsHtml}</div>`;
                        statusIcon = '<i class="fas fa-phone-alt text-green-500"></i>';
                    } else {
                        statusContent = `<div class="ml-7 text-xs"><span class="text-red-600 font-bold"><i class="fas fa-times"></i> Sem sucesso</span></div>`;
                        statusIcon = '<i class="fas fa-phone-slash text-red-500"></i>';
                    }

                    return `
                        <div class="mb-2 pb-2 border-b border-gray-100 last:border-0 last:pb-0">
                            <div class="flex items-center gap-2">
                                <div class="w-5 text-center">${statusIcon}</div>
                                <div class="text-xs text-gray-700 font-medium">
                                    ${attemptNum}ª Convocação <span class="text-gray-400 font-normal">(${formatDate(mDate)})</span>
                                </div>
                                ${notificationBtn}
                            </div>
                            ${statusContent}
                        </div>`;
                };

                historyHtml += renderAttemptBlock(1, record.meetingDate || record.meetingDate_1, record.meetingTime || record.meetingTime_1, record.contactSucceeded_1, record.contactDate_1, record.contactPerson_1, record.contactPrints_1, record.contactPrint_1);
                historyHtml += renderAttemptBlock(2, record.meetingDate_2, record.meetingTime_2, record.contactSucceeded_2, record.contactDate_2, record.contactPerson_2, record.contactPrints_2, record.contactPrint_2);
                historyHtml += renderAttemptBlock(3, record.meetingDate_3, record.meetingTime_3, record.contactSucceeded_3, record.contactDate_3, record.contactPerson_3, record.contactPrints_3, record.contactPrint_3);

                if (record?.oficioNumber) historyHtml += `<div class="flex items-center gap-2 mb-2"><div class="w-5 text-center"><i class="fas fa-landmark text-blue-500"></i></div><div class="text-xs text-gray-600"><strong>Encaminhado CT:</strong> Ofício ${record.oficioNumber}/${record.oficioYear}</div></div>`;
                if (record?.ctFeedback) historyHtml += `<div class="flex items-center gap-2 mb-2"><div class="w-5 text-center"><i class="fas fa-reply text-purple-500"></i></div><div class="text-xs text-gray-600"><strong>Devolutiva:</strong> Recebida</div></div>`;
                if (record?.parecerFinal) historyHtml += `<div class="flex items-center gap-2 mb-2"><div class="w-5 text-center"><i class="fas fa-gavel text-green-600"></i></div><div class="text-xs text-gray-600"><strong>Parecer Final:</strong> Registrado</div></div>`;

                if (historyHtml === '') historyHtml = `<p class="text-xs text-gray-400 italic pl-2">Aguardando início do acompanhamento.</p>`;

                const avancarBtn = `<button type="button" class="avancar-etapa-btn flex-1 bg-sky-600 text-white hover:bg-sky-700 text-xs font-semibold py-2 px-2 rounded transition shadow-sm ${isIndividualResolvido ? 'opacity-50 cursor-not-allowed' : ''}" ${isIndividualResolvido ? 'disabled' : ''} data-group-id="${incident.id}" data-student-id="${student.matricula}" data-record-id="${recordId}"><i class="fas fa-forward mr-1"></i> ${nextActionText}</button>`;

                const viewOficioBtn = record?.oficioNumber ? `<button type="button" class="view-occurrence-oficio-btn bg-green-50 text-green-700 hover:bg-green-100 text-xs font-semibold py-2 px-3 rounded border border-green-200 transition flex items-center gap-1" data-record-id="${recordId}" title="Ver Ofício"><i class="fas fa-file-alt"></i> Ver Ofício</button>` : '';

                const editActionBtn = `<button type="button" class="edit-occurrence-action-btn bg-gray-100 text-gray-600 hover:bg-gray-200 text-xs font-semibold py-2 px-3 rounded transition ${isFinalizada ? 'opacity-50 cursor-not-allowed' : ''}" data-group-id="${incident.id}" data-student-id="${student.matricula}" data-record-id="${recordId}" ${isFinalizada ? 'disabled' : ''} title="Editar"><i class="fas fa-pencil-alt"></i></button>`;
                const resetActionBtn = `<button type="button" class="reset-occurrence-action-btn bg-gray-100 text-red-500 hover:bg-red-100 text-xs font-semibold py-2 px-3 rounded transition ${isFinalizada ? 'opacity-50 cursor-not-allowed' : ''}" data-group-id="${incident.id}" data-student-id="${student.matricula}" data-record-id="${recordId}" ${isFinalizada ? 'disabled' : ''} title="Limpar"><i class="fas fa-undo-alt"></i></button>`;

                const contentId = `occ-content-${recordId || student.matricula}`;

                return `
                    <div class="bg-gray-50 rounded-lg border border-gray-200 mt-2 hover:shadow-sm transition-shadow">
                        <div class="occurrence-summary p-3 cursor-pointer hover:bg-gray-100 flex justify-between items-center" data-content-id="${contentId}">
                            <div class="flex flex-col sm:flex-row sm:items-center gap-2 w-full">
                                <div class="flex items-center gap-2">
                                    <i class="${iconClass} fa-fw w-4 text-center text-gray-400" title="${role}"></i>
                                    <div>
                                        <div class="text-sm font-bold text-gray-800 ${isMatch ? 'bg-yellow-200 px-1' : ''}">${student.name}</div>
                                        <div class="text-[10px] text-gray-500 font-semibold uppercase tracking-wide">${student.class || 'Turma?'} • <span class="${timeInfo.class}">${timeInfo.text}</span></div>
                                    </div>
                                </div>
                                <div class="flex items-center gap-2 sm:ml-auto mr-4">
                                     <span class="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${stepInfo.color}">${stepInfo.text}</span>
                                     ${getStatusBadge(status)}
                                </div>
                            </div>
                            <i class="fas fa-chevron-down transition-transform duration-300 text-gray-400"></i>
                        </div>
                        
                        <div id="${contentId}" class="process-content" style="max-height: 0px; overflow: hidden;">
                            <div class="p-3 border-t border-gray-200 bg-white">
                                <div class="space-y-1 mb-3 bg-gray-50 p-2 rounded border border-gray-100">
                                    ${historyHtml}
                                </div>
                                <div class="flex items-center gap-2 mt-3">
                                    ${viewOficioBtn}
                                    ${editActionBtn}
                                    ${resetActionBtn}
                                    ${avancarBtn}
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');

        return `
            <div class="border-l-4 ${borderColorClass} rounded-lg bg-white shadow-sm mb-4 transition hover:shadow-md">
                <div class="p-4">
                    <div class="flex flex-col sm:flex-row justify-between items-start gap-3 border-b border-gray-100 pb-3 mb-3">
                         <div class="w-full">
                            <div class="flex justify-between items-start">
                                <div>
                                    <h3 class="font-bold text-gray-800 text-base uppercase tracking-wide flex items-center gap-2">
                                        ${mainRecord.occurrenceType || 'Tipo não informado'}
                                    </h3>
                                    <p class="text-[10px] text-gray-400 mt-1 font-mono uppercase">
                                        <i class="far fa-calendar-alt"></i> ${formatDate(mainRecord.date)} • ID: ${incident.id}
                                    </p>
                                </div>
                                <div class="flex items-center gap-2">
                                    ${getStatusBadge(incident.overallStatus)}
                                    <div class="relative kebab-menu-container">
                                        <button class="kebab-menu-btn text-gray-400 hover:text-gray-700 p-1 rounded hover:bg-gray-100 transition" data-group-id="${incident.id}"><i class="fas fa-ellipsis-v"></i></button>
                                        <div class="kebab-menu-dropdown hidden absolute right-0 mt-1 w-48 bg-white rounded-md shadow-lg border z-10">
                                            <button class="kebab-action-btn menu-item w-full text-left" data-action="edit" data-group-id="${incident.id}"><i class="fas fa-pencil-alt mr-2 w-4"></i>Editar Fato</button>
                                            <button class="record-btn menu-item w-full text-left" data-group-id="${incident.id}"><i class="fas fa-file-invoice mr-2 w-4"></i>Gerar Ata</button>
                                            <button class="kebab-action-btn menu-item w-full text-left" data-action="history" data-group-id="${incident.id}"><i class="fas fa-history mr-2 w-4"></i>Histórico</button>
                                            <button class="kebab-action-btn menu-item menu-item-danger w-full text-left" data-action="delete" data-group-id="${incident.id}"><i class="fas fa-trash mr-2 w-4"></i>Excluir</button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div class="mt-2 text-xs text-gray-600 bg-gray-50 p-2 rounded border border-gray-100 line-clamp-2" title="${mainRecord.description}">
                                <span class="font-bold text-gray-500 uppercase text-[10px]">Fato:</span> ${mainRecord.description}
                            </div>
                         </div>
                    </div>
                    <div class="space-y-0">
                        ${studentAccordionsHTML}
                    </div>
                </div>
            </div>`;
    }).join('');
    dom.occurrencesListDiv.innerHTML = html;
};

export const openOccurrenceModal = (incidentToEdit = null) => {
    dom.occurrenceForm.reset();
    state.selectedStudents.clear();

    const occurrenceDateInput = document.getElementById('occurrence-date');
    const todayLocal = new Date().toLocaleDateString('en-CA');
    occurrenceDateInput.max = todayLocal;

    if (incidentToEdit) {
        const mainRecord = incidentToEdit.records[0];
        document.getElementById('modal-title').innerText = 'Editar Fato da Ocorrência';
        document.getElementById('occurrence-group-id').value = incidentToEdit.id;

        incidentToEdit.participantsInvolved.forEach((data, studentId) => {
            state.selectedStudents.set(studentId, { student: data.student, role: data.role });
        });

        document.getElementById('occurrence-type').value = mainRecord.occurrenceType || '';
        occurrenceDateInput.value = mainRecord.date || '';
        document.getElementById('description').value = mainRecord.description || '';
        document.getElementById('providencias-escola').value = mainRecord.providenciasEscola || '';
    } else {
        document.getElementById('modal-title').innerText = 'Registar Nova Ocorrência';
        document.getElementById('occurrence-group-id').value = '';
        occurrenceDateInput.value = todayLocal;
    }

    const studentInput = document.getElementById('student-search-input');
    const suggestionsDiv = document.getElementById('student-suggestions');
    const tagsContainer = document.getElementById('student-tags-container');
    setupStudentTagInput(studentInput, suggestionsDiv, tagsContainer);

    openModal(dom.occurrenceModal);
};

const toggleOccurrenceContactFields = (enable) => {
    const fieldsContainer = document.getElementById('group-contato-fields');
    if (!fieldsContainer) return;

    fieldsContainer.classList.toggle('hidden', !enable);
    const detailFields = fieldsContainer.querySelectorAll('select, input[type="date"], input[type="text"], textarea');

    detailFields.forEach(input => {
        input.disabled = !enable;
        input.required = enable;
    });
};

const toggleDesfechoFields = (choice) => {
    document.getElementById('group-encaminhamento-ct')?.classList.add('hidden');
    document.getElementById('group-parecer-final')?.classList.add('hidden');

    const groupCt = document.getElementById('group-encaminhamento-ct');
    const groupParecer = document.getElementById('group-parecer-final');
    const oficioInput = document.getElementById('follow-up-oficio-number');
    const dateCtInput = document.getElementById('follow-up-ct-sent-date');
    const parecerInput = document.getElementById('follow-up-parecer-final');

    const showCt = choice === 'ct';
    const showParecer = choice === 'parecer';

    if (groupCt) groupCt.classList.toggle('hidden', !showCt);
    if (groupParecer) groupParecer.classList.toggle('hidden', !showParecer);

    if (oficioInput) { oficioInput.disabled = !showCt; oficioInput.required = showCt; }
    if (dateCtInput) { dateCtInput.disabled = !showCt; dateCtInput.required = showCt; }

    if (parecerInput) { parecerInput.disabled = !showParecer; parecerInput.required = showParecer; }
};

export const openOccurrenceStepModal = async (student, record, actionType, preFilledData = null) => {
    // -------------------------------------------------------------------------
    // BLOQUEIO DE SEGURANÇA: Verificar Assinatura (Feedback)
    // -------------------------------------------------------------------------
    if (actionType.startsWith('feedback_')) {
        const attemptNum = actionType.split('_')[1];
        const incidentId = record.incidentId || record.occurrenceGroupId; // Ensure this is passed

        if (incidentId) {
            const uniqueRefId = `${incidentId}_${student.matricula}_attempt_${attemptNum}`;
            const notifDoc = await findDocumentSnapshot('notificacao_ocorrencia', student.matricula, uniqueRefId);

            // Regra: Deve document existir E ter assinatura do responsável específico
            let isSigned = false;

            if (notifDoc && notifDoc.signatures) {
                // Validação Estrita: Verifica se o responsável DESTE aluno assinou
                const requiredKey = `responsible_${student.matricula}`;
                // Validação: Assinatura deve existir (truthy)
                isSigned = !!notifDoc.signatures[requiredKey];
            }

            if (!isSigned) {
                await showAlert(`Ação Bloqueada: A Notificação da ${attemptNum}ª Tentativa não possui a assinatura do responsável (Aluno: ${student.name}).\n\nÉ obrigatória a assinatura do responsável para registrar o feedback.`);
                return; // ABORTAR ABERTURA
            }
        } else {
            console.error("[Validação Ocorrência] Erro Crítico: Incident ID não encontrado no registro.", record);
            await showAlert("Erro de Validação: Não foi possível identificar o ID da ocorrência para verificar as assinaturas.\n\nPor favor, recarregue a página e tente novamente.");
            return;
        }
    }
    // -------------------------------------------------------------------------

    const followUpForm = document.getElementById('follow-up-form');
    followUpForm.reset();

    pendingFiles = [];
    document.getElementById('follow-up-print-label').textContent = 'Selecionar Arquivos';
    document.getElementById('follow-up-print-check').classList.add('hidden');

    let previewContainer = document.getElementById('follow-up-print-preview');
    if (!previewContainer) {
        const fileInput = document.getElementById('follow-up-contact-print');
        if (fileInput) {
            fileInput.setAttribute('multiple', 'multiple');
            previewContainer = document.createElement('div');
            previewContainer.id = 'follow-up-print-preview';
            previewContainer.className = 'flex flex-wrap gap-2 mt-2 hidden';
            fileInput.parentElement.parentElement.appendChild(previewContainer);
        }
    } else {
        previewContainer.innerHTML = '';
        previewContainer.classList.add('hidden');
    }

    followUpForm.dataset.recordId = record.id;
    followUpForm.dataset.studentId = student.matricula;
    followUpForm.dataset.actionType = actionType;

    document.getElementById('follow-up-student-name').value = student.name;

    const statusDisplay = document.getElementById('follow-up-status-display');
    const modalTitle = document.getElementById('follow-up-modal-title');

    modalTitle.textContent = occurrenceActionTitles[actionType] || 'Acompanhamento Individual';
    statusDisplay.innerHTML = `<strong>Status:</strong> ${getStatusBadge(record.statusIndividual || 'Aguardando Convocação')}`;

    const studentInfoBlock = document.querySelector('#follow-up-form fieldset:first-of-type');
    if (studentInfoBlock) studentInfoBlock.classList.add('hidden');

    ['follow-up-meeting-date', 'follow-up-contact-date', 'follow-up-ct-sent-date'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.removeAttribute('min');
    });

    document.querySelectorAll('.dynamic-occurrence-step').forEach(group => {
        group.classList.add('hidden');
        group.querySelectorAll('input, select, textarea, button').forEach(el => {
            if (el.type !== 'file') el.disabled = true;
            el.required = false;
        });
        group.querySelectorAll('input[type="radio"]').forEach(radio => radio.checked = false);
    });
    toggleDesfechoFields(null);
    toggleOccurrenceContactFields(false);

    let currentGroup = null;

    if (actionType.startsWith('convocacao_')) {
        const attemptNum = actionType.split('_')[1];
        currentGroup = document.getElementById('group-convocacao');
        if (currentGroup) {
            currentGroup.classList.remove('hidden');
            currentGroup.querySelector('legend').textContent = `Ação 2: Agendar ${attemptNum}ª Convocação`;

            const dateInput = document.getElementById('follow-up-meeting-date');
            const timeInput = document.getElementById('follow-up-meeting-time');

            const existingDate = record[`meetingDate_${attemptNum}`] || (attemptNum == 1 ? record.meetingDate : null);
            const existingTime = record[`meetingTime_${attemptNum}`] || (attemptNum == 1 ? record.meetingTime : null);

            dateInput.value = existingDate || '';
            timeInput.value = existingTime || '';
            dateInput.disabled = false; dateInput.required = true;
            timeInput.disabled = false; timeInput.required = true;

            if (attemptNum == 1) {
                if (record.date) dateInput.min = record.date;
            } else {
                const prevAttempt = attemptNum - 1;
                const prevDate = record[`meetingDate_${prevAttempt}`] || (prevAttempt == 1 ? record.meetingDate : null);
                if (prevDate) dateInput.min = prevDate;
            }
        }

    } else if (actionType.startsWith('feedback_')) {
        const attemptNum = parseInt(actionType.split('_')[1]);
        currentGroup = document.getElementById('group-contato');
        if (currentGroup) {
            currentGroup.classList.remove('hidden');
            const legend = document.getElementById('legend-contato');
            if (legend) legend.textContent = `Ação 3: Feedback da ${attemptNum}ª Tentativa`;

            const radios = currentGroup.querySelectorAll('input[name="follow-up-contact-succeeded"]');
            radios.forEach(r => { r.disabled = false; r.required = true; });

            if (preFilledData && preFilledData.succeeded) {
                const radio = currentGroup.querySelector(`input[value="${preFilledData.succeeded}"]`);
                if (radio) radio.checked = true;
                toggleOccurrenceContactFields(preFilledData.succeeded === 'yes');
            } else {
                const currentSucceededValue = record[`contactSucceeded_${attemptNum}`];
                const radioChecked = document.querySelector(`input[name="follow-up-contact-succeeded"][value="${currentSucceededValue}"]`);
                if (radioChecked) radioChecked.checked = true;
                toggleOccurrenceContactFields(currentSucceededValue === 'yes');
            }

            document.getElementById('follow-up-contact-type').value = record[`contactType_${attemptNum}`] || '';
            const contactDateInput = document.getElementById('follow-up-contact-date');
            contactDateInput.value = record[`contactDate_${attemptNum}`] || '';
            document.getElementById('follow-up-contact-person').value = record[`contactPerson_${attemptNum}`] || '';

            const meetingDate = record[`meetingDate_${attemptNum}`] || (attemptNum == 1 ? record.meetingDate : null);
            if (meetingDate) contactDateInput.min = meetingDate;

            document.getElementById('follow-up-family-actions').value = record[`providenciasFamilia_${attemptNum}`] || '';
        }

    } else if (actionType === 'desfecho_ou_ct') {
        const choiceGroup = document.getElementById('group-desfecho-choice');
        if (choiceGroup) {
            choiceGroup.classList.remove('hidden');
            const choiceRadios = choiceGroup.querySelectorAll('input[name="follow-up-desfecho-choice"]');
            choiceRadios.forEach(r => { r.disabled = false; r.required = true; });

            const currentChoice = record.desfechoChoice || null;
            if (currentChoice) {
                const radioToCheck = choiceGroup.querySelector(`input[value="${currentChoice}"]`);
                if (radioToCheck) radioToCheck.checked = true;
                toggleDesfechoFields(currentChoice);
            } else {
                toggleDesfechoFields(null);
            }
        }

        const oficioInput = document.getElementById('follow-up-oficio-number');
        const dateCtInput = document.getElementById('follow-up-ct-sent-date');
        const parecerInput = document.getElementById('follow-up-parecer-final');
        if (oficioInput) oficioInput.value = record.oficioNumber || '';
        if (dateCtInput) dateCtInput.value = record.ctSentDate || '';
        if (parecerInput) parecerInput.value = record.parecerFinal || '';

        if (dateCtInput) {
            let lastContactDate = record.contactDate_3 || record.contactDate_2 || record.contactDate_1 || record.meetingDate;
            if (lastContactDate) dateCtInput.min = lastContactDate;
        }

    } else if (actionType === 'devolutiva_ct') {
        currentGroup = document.getElementById('group-devolutiva-ct');
        if (currentGroup) {
            currentGroup.classList.remove('hidden');
            const feedbackInput = document.getElementById('follow-up-ct-feedback');
            feedbackInput.value = record.ctFeedback || '';
            feedbackInput.disabled = false; feedbackInput.required = true;
        }

    } else if (actionType === 'parecer_final') {
        currentGroup = document.getElementById('group-parecer-final');
        if (currentGroup) {
            currentGroup.classList.remove('hidden');
            const parecerInputFinal = document.getElementById('follow-up-parecer-final');
            parecerInputFinal.value = record.parecerFinal || '';
            parecerInputFinal.disabled = false; parecerInputFinal.required = true;
        }
    }

    followUpForm.classList.remove('hidden');
    openModal(dom.followUpModal);
};

async function handleOccurrenceSubmit(e) {
    e.preventDefault();
    const form = e.target;
    if (!form.checkValidity()) {
        form.reportValidity();
        showAlert("Por favor, preencha todos os campos obrigatórios (*).");
        return;
    }

    const groupId = document.getElementById('occurrence-group-id').value;
    if (state.selectedStudents.size === 0) return showAlert("Selecione pelo menos um aluno.");

    const participants = Array.from(state.selectedStudents.entries()).map(([studentId, data]) => ({
        studentId: studentId,
        role: data.role,
        studentName: data.student.name,
        studentClass: data.student.class
    }));

    const collectiveData = {
        date: document.getElementById('occurrence-date').value,
        occurrenceType: document.getElementById('occurrence-type').value,
        description: document.getElementById('description').value.trim(),
        providenciasEscola: document.getElementById('providencias-escola').value.trim(),
        participants: participants
    };

    const today = new Date().toISOString().split('T')[0];
    if (collectiveData.date > today) {
        return showAlert("Erro: A data da ocorrência não pode ser no futuro.");
    }

    if (!collectiveData.providenciasEscola) {
        showAlert("O campo 'Providências da Escola' é obrigatório.");
        document.getElementById('providencias-escola').focus();
        return;
    }

    try {
        if (groupId) {
            const originalIncident = await fetchIncidentById(groupId);
            if (!originalIncident) throw new Error("Incidente original não encontrado para edição.");

            const historyAction = "Dados gerais do fato (Ação 1) atualizados (incluindo participantes/papéis).";
            const batch = writeBatch(db);
            const currentParticipantIds = participants.map(p => p.studentId);

            for (const participant of participants) {
                const studentId = participant.studentId;
                const existingRecord = originalIncident.records.find(r => r.studentId === studentId);

                if (existingRecord) {
                    const recordRef = doc(getCollectionRef('occurrence'), existingRecord.id);
                    batch.update(recordRef, collectiveData);
                } else {
                    const newRecordRef = doc(collection(db, getCollectionRef('occurrence').path));
                    const newRecordData = {
                        ...collectiveData,
                        studentId,
                        studentName: participant.studentName,
                        studentClass: participant.studentClass,

                        occurrenceGroupId: groupId,
                        statusIndividual: 'Aguardando Convocação 1',
                        meetingDate: null, meetingTime: null,
                        contactSucceeded_1: null, contactType_1: null, contactDate_1: null, contactPerson_1: null, providenciasFamilia_1: null,
                        contactSucceeded_2: null, contactType_2: null, contactDate_2: null, contactPerson_2: null, providenciasFamilia_2: null,
                        contactSucceeded_3: null, contactType_3: null, contactDate_3: null, contactPerson_3: null, providenciasFamilia_3: null,
                        oficioNumber: null, oficioYear: null, ctSentDate: null,
                        ctFeedback: null, parecerFinal: null,
                        desfechoChoice: null,
                        createdAt: new Date(), createdBy: state.userEmail,
                        history: [{ action: 'Incidente registrado (aluno adicionado durante edição)', user: state.userEmail, timestamp: new Date() }]
                    };
                    batch.set(newRecordRef, newRecordData);
                }
            }

            const removedStudentIds = originalIncident.records
                .map(r => r.studentId)
                .filter(id => !currentParticipantIds.includes(id));

            for (const studentId of removedStudentIds) {
                const recordToDelete = originalIncident.records.find(r => r.studentId === studentId);
                if (recordToDelete) {
                    batch.delete(doc(getCollectionRef('occurrence'), recordToDelete.id));
                }
            }

            const recordsToUpdateHistoryQuery = query(getCollectionRef('occurrence'), where('occurrenceGroupId', '==', groupId));
            const recordsToUpdateHistorySnap = await getDocs(recordsToUpdateHistoryQuery);
            recordsToUpdateHistorySnap.docs.forEach(docSnapshot => {
                if (currentParticipantIds.includes(docSnapshot.data().studentId)) {
                    const newHistoryEntry = { action: historyAction, user: state.userEmail, timestamp: new Date() };
                    const currentHistory = docSnapshot.data().history || [];
                    batch.update(docSnapshot.ref, { history: [...currentHistory, newHistoryEntry] });
                }
            });

            await batch.commit();
            showToast('Fato da ocorrência atualizado com sucesso!');

        } else {
            const counterRef = getCounterDocRef('occurrences');
            const newGroupId = await runTransaction(db, async (transaction) => {
                const counterDoc = await transaction.get(counterRef);
                const currentYear = new Date().getFullYear();
                let newCount = 1;
                if (counterDoc.exists() && counterDoc.data().year === currentYear) {
                    newCount = counterDoc.data().count + 1;
                }
                transaction.set(counterRef, { count: newCount, year: currentYear });
                return `OCC-${currentYear}-${String(newCount).padStart(3, '0')}`;
            });

            for (const participant of participants) {
                const recordData = {
                    ...collectiveData,
                    studentId: participant.studentId,
                    studentName: participant.studentName,
                    studentClass: participant.studentClass,

                    occurrenceGroupId: newGroupId,
                    statusIndividual: 'Aguardando Convocação 1',
                    meetingDate: null, meetingTime: null,
                    contactSucceeded_1: null, contactType_1: null, contactDate_1: null, contactPerson_1: null, providenciasFamilia_1: null,
                    contactSucceeded_2: null, contactType_2: null, contactDate_2: null, contactPerson_2: null, providenciasFamilia_2: null,
                    contactSucceeded_3: null, contactType_3: null, contactDate_3: null, contactPerson_3: null, providenciasFamilia_3: null,
                    oficioNumber: null, oficioYear: null, ctSentDate: null,
                    ctFeedback: null, parecerFinal: null,
                    desfechoChoice: null
                };
                await addRecordWithHistory('occurrence', recordData, 'Incidente registrado (Ação 1)', state.userEmail);
            }
            showToast(`Ocorrência ${newGroupId} registrada com sucesso!`);
        }
        closeModal(dom.occurrenceModal);
    } catch (error) {
        console.error("Erro ao salvar ocorrência:", error);
        showAlert('Erro ao salvar a ocorrência.');
    }
}

async function handleOccurrenceStepSubmit(e) {
    e.preventDefault();
    const form = e.target;
    if (!form.checkValidity()) {
        form.reportValidity();
        return showAlert('Por favor, preencha todos os campos obrigatórios (*).');
    }

    const recordId = form.dataset.recordId;
    const actionType = form.dataset.actionType;
    if (!recordId || !actionType) return showAlert("Erro: ID do registro ou tipo de ação não encontrado.");

    const record = state.occurrences.find(r => r.id === recordId);
    if (!record) return showAlert("Erro: Registro original não encontrado.");

    const submitBtn = form.querySelector('button[type="submit"]');
    const originalBtnText = submitBtn.innerText;
    let uploadedUrls = [];

    if (pendingFiles.length > 0) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Enviando arquivos...`;

        try {
            const uploadPromises = pendingFiles.map(file => uploadToStorage(file));
            uploadedUrls = await Promise.all(uploadPromises);
        } catch (uploadError) {
            submitBtn.disabled = false;
            submitBtn.innerText = originalBtnText;

            // O erro já vem tratado do utils.js, então mostramos direto
            return showAlert(uploadError.message);
        }
    }

    let dataToUpdate = {};
    let historyAction = "";
    let nextStatus = record.statusIndividual;

    try {
        if (actionType.startsWith('convocacao_')) {
            const attemptNum = actionType.split('_')[1];
            const dateField = attemptNum == 1 ? 'meetingDate' : `meetingDate_${attemptNum}`;
            const timeField = attemptNum == 1 ? 'meetingTime' : `meetingTime_${attemptNum}`;

            const inputDate = document.getElementById('follow-up-meeting-date').value;
            const inputTime = document.getElementById('follow-up-meeting-time').value;

            if (!inputDate || !inputTime) throw new Error('Data e Horário obrigatórios.');

            const dateCheck = validateOccurrenceChronology(record, actionType, inputDate);
            if (!dateCheck.isValid) throw new Error(dateCheck.message);

            if (attemptNum == 1) {
                const incident = await fetchIncidentById(record.occurrenceGroupId);
                const otherPendingRecords = incident.records.filter(r =>
                    r.id !== recordId && r.statusIndividual === 'Aguardando Convocação 1'
                );

                if (otherPendingRecords.length > 0 && confirm(`Existem outros ${otherPendingRecords.length} alunos neste incidente aguardando a 1ª convocação. Deseja agendar para todos na mesma data e horário?`)) {
                    const batch = writeBatch(db);
                    const batchUpdateData = {
                        [dateField]: inputDate,
                        [timeField]: inputTime,
                        statusIndividual: `Aguardando Feedback 1`,
                        updatedAt: new Date(),
                        updatedBy: state.userEmail
                    };
                    const batchHistoryAction = `Ação 2 (1ª Convocação) agendada em lote para ${formatDate(inputDate)} às ${formatTime(inputTime)}.`;

                    otherPendingRecords.forEach(otherRec => {
                        const ref = doc(getCollectionRef('occurrence'), otherRec.id);
                        batch.update(ref, {
                            ...batchUpdateData,
                            history: [...(otherRec.history || []), { action: batchHistoryAction, user: state.userEmail, timestamp: new Date() }]
                        });
                    });
                    await batch.commit();
                    showToast(`Agendamento replicado para mais ${otherPendingRecords.length} alunos.`);
                }
            }

            dataToUpdate = { [dateField]: inputDate, [timeField]: inputTime };
            historyAction = `Ação 2 (${attemptNum}ª Convocação) agendada para ${formatDate(inputDate)} às ${formatTime(inputTime)}.`;
            nextStatus = `Aguardando Feedback ${attemptNum}`;

        } else if (actionType.startsWith('feedback_')) {
            const attemptNum = parseInt(actionType.split('_')[1]);
            
            // --- VALIDAÇÃO DE ASSINATURA OBRIGATÓRIA (SALVAMENTO) ---
            const studentId = form.dataset.studentId;
            const incidentId = record.incidentId || record.occurrenceGroupId;

            if (incidentId && studentId) {
                const uniqueRefId = `${incidentId}_${studentId}_attempt_${attemptNum}`;
                const notifDoc = await findDocumentSnapshot('notificacao_ocorrencia', studentId, uniqueRefId);
                let isSigned = false;
                if (notifDoc && notifDoc.signatures) {
                    const requiredKey = `responsible_${studentId}`;
                    isSigned = !!notifDoc.signatures[requiredKey];
                }

                if (!isSigned) {
                     throw new Error(`Ação Bloqueada: A Notificação não foi assinada pelo responsável.\n\nÉ obrigatória a assinatura para registrar o feedback.`);
                }
            }
            // ---------------------------------------------------------

            const contactSucceededRadio = document.querySelector('input[name="follow-up-contact-succeeded"]:checked');
            const contactSucceeded = contactSucceededRadio ? contactSucceededRadio.value : null;

            if (!contactSucceeded) throw new Error('Selecione se conseguiu contato.');

            const fields = {
                succeeded: `contactSucceeded_${attemptNum}`,
                type: `contactType_${attemptNum}`,
                date: `contactDate_${attemptNum}`,
                person: `contactPerson_${attemptNum}`,
                providencias: `providenciasFamilia_${attemptNum}`,
                prints: `contactPrints_${attemptNum}`
            };

            if (contactSucceeded === 'yes') {
                dataToUpdate = {
                    [fields.succeeded]: 'yes',
                    [fields.type]: document.getElementById('follow-up-contact-type').value,
                    [fields.date]: document.getElementById('follow-up-contact-date').value,
                    [fields.person]: document.getElementById('follow-up-contact-person').value.trim(),
                    [fields.providencias]: document.getElementById('follow-up-family-actions').value,
                };

                if (uploadedUrls.length > 0) {
                    dataToUpdate[fields.prints] = uploadedUrls;
                }

                if (!dataToUpdate[fields.type] || !dataToUpdate[fields.date] || !dataToUpdate[fields.providencias] || !dataToUpdate[fields.person]) {
                    throw new Error('Preencha Tipo, Data, Com quem falou e Providências.');
                }

                const dateCheck = validateOccurrenceChronology(record, actionType, dataToUpdate[fields.date]);
                if (!dateCheck.isValid) throw new Error(dateCheck.message);

                historyAction = `Ação 3 (Feedback da ${attemptNum}ª Tentativa): Contato realizado com ${dataToUpdate[fields.person]}.`;
                if (uploadedUrls.length > 0) historyAction += ` (${uploadedUrls.length} anexos enviados).`;

                nextStatus = 'Aguardando Desfecho';

            } else {
                dataToUpdate = {
                    [fields.succeeded]: 'no',
                    [fields.type]: null, [fields.date]: null, [fields.person]: null, [fields.providencias]: null, [fields.prints]: null
                };
                historyAction = `Ação 3 (Feedback da ${attemptNum}ª Tentativa): Contato sem sucesso.`;

                if (attemptNum === 1) nextStatus = 'Aguardando Convocação 2';
                else if (attemptNum === 2) nextStatus = 'Aguardando Convocação 3';
                else nextStatus = 'Aguardando Desfecho';
            }

        } else if (actionType === 'desfecho_ou_ct') {
            const desfechoChoiceRadio = document.querySelector('input[name="follow-up-desfecho-choice"]:checked');
            const desfechoChoice = desfechoChoiceRadio ? desfechoChoiceRadio.value : null;

            if (!desfechoChoice) throw new Error("Erro: Escolha uma opção.");

            if (desfechoChoice === 'ct') {
                const oficioNumber = document.getElementById('follow-up-oficio-number').value.trim();
                const ctSentDate = document.getElementById('follow-up-ct-sent-date').value;

                if (!oficioNumber || !ctSentDate) throw new Error("Erro: Preencha o Ofício e Data.");

                const dateCheck = validateOccurrenceChronology(record, 'desfecho_ou_ct', ctSentDate);
                if (!dateCheck.isValid) throw new Error(dateCheck.message);

                dataToUpdate = {
                    oficioNumber, ctSentDate,
                    oficioYear: new Date(ctSentDate).getFullYear() || new Date().getFullYear(),
                    parecerFinal: null,
                    desfechoChoice: 'ct'
                };
                historyAction = `Ação 4 (Encaminhamento ao CT) registrada. Ofício: ${oficioNumber}/${dataToUpdate.oficioYear}.`;
                nextStatus = 'Aguardando Devolutiva CT';

            } else {
                const parecerFinal = document.getElementById('follow-up-parecer-final').value.trim();
                if (!parecerFinal) throw new Error("Erro: Preencha o Parecer.");
                dataToUpdate = {
                    parecerFinal,
                    oficioNumber: null, ctSentDate: null, oficioYear: null, ctFeedback: null,
                    desfechoChoice: 'parecer'
                };
                historyAction = `Ação 6 (Parecer Final) registrada diretamente.`;
                nextStatus = 'Resolvido';
            }

        } else if (actionType === 'devolutiva_ct') {
            dataToUpdate = {
                ctFeedback: document.getElementById('follow-up-ct-feedback').value.trim(),
            };
            if (!dataToUpdate.ctFeedback) throw new Error("Erro: Preencha a Devolutiva.");
            historyAction = `Ação 5 (Devolutiva do CT) registrada.`;
            nextStatus = 'Aguardando Parecer Final';

        } else if (actionType === 'parecer_final') {
            dataToUpdate = {
                parecerFinal: document.getElementById('follow-up-parecer-final').value.trim(),
            };
            if (!dataToUpdate.parecerFinal) throw new Error("Erro: Preencha o Parecer final.");
            historyAction = `Ação 6 (Parecer Final) registrada após devolutiva do CT.`;
            nextStatus = 'Resolvido';
        }

        dataToUpdate.statusIndividual = nextStatus;
        await updateRecordWithHistory('occurrence', recordId, dataToUpdate, historyAction, state.userEmail);
        showToast("Etapa salva com sucesso!");

        const studentId = form.dataset.studentId;
        const student = state.students.find(s => s.matricula === studentId);
        if (actionType === 'desfecho_ou_ct' && dataToUpdate.desfechoChoice === 'ct' && student) {
            generateAndShowOccurrenceOficio({ ...record, ...dataToUpdate }, student, dataToUpdate.oficioNumber, dataToUpdate.oficioYear);
        }
        if (actionType.startsWith('convocacao_') && student) {
            // Busca o incidente ATUALIZADO após o update para garantir que a notificação tenha os dados corretos.
            const updatedIncident = await fetchIncidentById(record.occurrenceGroupId);
            if (updatedIncident) {
                const attemptNum = parseInt(actionType.split('_')[1]) || 1;
                // A função openIndividualNotificationModal agora lida com a busca do registro correto e o salvamento.
                openIndividualNotificationModal(updatedIncident, student, attemptNum);
            }
        }

        closeModal(dom.followUpModal);

    } catch (collectError) {
        console.error("Erro ao processar etapa:", collectError);
        showAlert(collectError.message || "Erro desconhecido.");
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerText = originalBtnText;
    }
}

async function handleEditOccurrence(groupId) {
    const incident = await fetchIncidentById(groupId);
    if (incident) {
        if (incident.overallStatus === 'Finalizada') return showAlert('Ocorrência finalizada. Não é possível editar.');
        openOccurrenceModal(incident);
    } else {
        showAlert('Incidente não encontrado.');
    }
}

async function handleEditOccurrenceAction(studentId, groupId, recordId) {
    const incident = await fetchIncidentById(groupId);
    if (!incident) return showAlert('Erro: Incidente não encontrado.');
    if (incident.overallStatus === 'Finalizada') return showAlert('Ocorrência finalizada. Não é possível editar.');

    const participantData = incident.participantsInvolved.get(studentId);
    const student = participantData?.student;
    if (!student) return showAlert('Erro: Aluno não encontrado.');

    const record = incident.records.find(r => r.id === recordId);
    if (!record) return showAlert('Erro: Registro não encontrado.');

    let actionToEdit = determineCurrentActionFromStatus(record.statusIndividual);

    if (!actionToEdit) {
        return showAlert('Estado inválido para edição direta.');
    }

    openOccurrenceStepModal(student, record, actionToEdit);
}

async function handleResetActionConfirmation(studentId, groupId, recordId) {
    const incident = await fetchIncidentById(groupId);
    if (!incident) return showAlert('Erro: Incidente não encontrado.');
    if (incident.overallStatus === 'Finalizada') return showAlert('Ocorrência finalizada. Não é possível limpar.');

    const record = incident.records.find(r => r.id === recordId);
    if (!record) return showAlert('Erro: Registro não encontrado.');

    let actionToReset = determineCurrentActionFromStatus(record.statusIndividual);

    if (actionToReset === null) {
        return showAlert('Não é possível Limpar a Ação 1 (Fato). Use "Editar Fato".');
    }

    const actionTitle = occurrenceActionTitles[actionToReset] || `Etapa '${actionToReset}'`;

    document.getElementById('delete-confirm-message').textContent = `Tem certeza que deseja Limpar a etapa: "${actionTitle}"?
        Isso limpará permanentemente todos os dados desta etapa e de quaisquer etapas futuras.`;

    state.recordToDelete = {
        type: 'occurrence-reset',
        recordId: recordId,
        actionToReset: actionToReset,
        historyAction: `Etapa "${actionTitle}" resetada pelo utilizador.`
    };

    openModal(dom.deleteConfirmModal);
}

function handleDelete(type, id) {
    const incident = state.occurrences.find(occ => occ.occurrenceGroupId === id || occ.id === id);
    if (incident && incident.overallStatus === 'Finalizada') return showAlert('Ocorrência finalizada. Não é possível excluir.');

    document.getElementById('delete-confirm-message').textContent = 'Tem certeza que deseja excluir este incidente e todos os seus registros associados?';
    state.recordToDelete = { type, id };
    openModal(dom.deleteConfirmModal);
}

async function handleNewOccurrenceAction(studentId, groupId, recordId) {
    const incident = await fetchIncidentById(groupId);
    if (!incident) return showAlert('Erro: Incidente não encontrado.');

    const participantData = incident.participantsInvolved.get(studentId);
    const student = participantData?.student;
    if (!student) return showAlert('Erro: Aluno não encontrado.');

    const record = incident.records.find(r => r.id === recordId);
    if (!record) return showAlert('Erro: Registro não encontrado.');

    const nextAction = determineNextOccurrenceStep(record.statusIndividual);

    if (nextAction === null) {
        showAlert('Processo finalizado. Use "Editar Ação" ou "Limpar Ação".');
        return;
    }
    record.incidentId = incident.id; // Pass incident ID for uniqueRefId generation
    await openOccurrenceStepModal(student, record, nextAction);
}

async function handleQuickFeedback(studentId, groupId, recordId, actionType, value) {
    // 1. Busca dados preliminares para validação
    const incident = await fetchIncidentById(groupId);
    if (!incident) return showAlert('Erro: Incidente não encontrado.');

    const participantData = incident.participantsInvolved.get(studentId);
    const student = participantData?.student;
    if (!student) return showAlert('Erro: Aluno não encontrado.');

    const record = incident.records.find(r => r.id === recordId);
    if (!record) return showAlert('Erro: Registro não encontrado.');

    // 2. BLOQUEIO DE SEGURANÇA (Igual ao Modal)
    if (actionType.startsWith('feedback_')) {
        const attemptNum = actionType.split('_')[1];
        // Garantir ID do incidente para o Ref
        const incidentIdForRef = incident.id || record.incidentId || record.occurrenceGroupId;

        if (incidentIdForRef) {
            const uniqueRefId = `${incidentIdForRef}_${student.matricula}_attempt_${attemptNum}`;
            const notifDoc = await findDocumentSnapshot('notificacao_ocorrencia', student.matricula, uniqueRefId);


            let isSigned = false;
            if (notifDoc && notifDoc.signatures) {
                const requiredKey = `responsible_${student.matricula}`;
                // CORREÇÃO: Assinatura é um objeto, não boolean true. Usar !! para verificar existência.
                isSigned = !!notifDoc.signatures[requiredKey];
            }

            if (!isSigned) {
                await showAlert(`Ação Bloqueada: A Notificação da ${attemptNum}ª Tentativa não possui a assinatura do responsável (Aluno: ${student.name}).\n\nÉ obrigatória a assinatura do responsável para registrar o feedback (Sim ou Não).`);
                return; // ABORTA TUDO
            }
        }
    }

    // 3. Processamento da Ação
    if (value === 'no') {
        const attemptNum = parseInt(actionType.split('_')[1]);
        const fields = { succeeded: `contactSucceeded_${attemptNum}` };

        let nextStatus = 'Aguardando Desfecho';
        if (attemptNum === 1) nextStatus = 'Aguardando Convocação 2';
        else if (attemptNum === 2) nextStatus = 'Aguardando Convocação 3';

        const dataToUpdate = {
            [fields.succeeded]: 'no',
            statusIndividual: nextStatus
        };
        const historyAction = `Ação 3 (Feedback da ${attemptNum}ª Tentativa): Contato sem sucesso (Salvo Rápido).`;

        try {
            await updateRecordWithHistory('occurrence', recordId, dataToUpdate, historyAction, state.userEmail);
            showToast('Feedback "Sem Sucesso" registrado.');
        } catch (e) {
            console.error(e);
            showAlert('Erro ao salvar feedback.');
        }
        return;
    }

    // Pass incident ID safely
    record.incidentId = incident.id;
    await openOccurrenceStepModal(student, record, actionType, { succeeded: value });
}

async function handleGenerateNotification(recordId, studentId, groupId, attemptNum) {
    const incident = await fetchIncidentById(groupId);
    if (!incident) return showAlert('Erro: Incidente não encontrado.');

    const participantData = incident.participantsInvolved.get(studentId);
    const student = participantData?.student;
    if (!student) return showAlert('Erro: Aluno não encontrado.');

    openIndividualNotificationModal(incident, student, attemptNum);
}

async function handleViewOccurrenceOficio(recordId) {
    try {
        if (!recordId) return;
        let targetRecord = null; let targetIncident = null;

        const recordFromState = state.occurrences.find(r => r.id === recordId);
        if (!recordFromState || !recordFromState.occurrenceGroupId) {
            return showAlert('Registro não encontrado localmente.');
        }

        targetIncident = await fetchIncidentById(recordFromState.occurrenceGroupId);
        if (!targetIncident) return showAlert('Incidente não encontrado no servidor.');

        targetRecord = targetIncident.records.find(r => r.id === recordId);
        if (!targetRecord) return showAlert('Registro específico não encontrado.');

        if (!targetRecord.oficioNumber) return showAlert('Este registro não possui um ofício associado.');

        const participantData = targetIncident.participantsInvolved.get(targetRecord.studentId);
        let student = participantData?.student;

        if (!student) {
            console.warn("Aviso: Aluno não encontrado no mapa de participantes. Usando dados do registro para forçar abertura.");
            student = {
                matricula: targetRecord.studentId,
                name: targetRecord.studentName || `Aluno (${targetRecord.studentId})`,
                class: targetRecord.studentClass || 'N/A',
                endereco: '',
                contato: ''
            };
        }

        await generateAndShowOccurrenceOficio(
            targetRecord,
            student,
            targetRecord.oficioNumber,
            targetRecord.oficioYear
        );

    } catch (e) {
        console.error("Erro fatal ao abrir ofício de ocorrência:", e);
        showAlert("Erro interno ao abrir o ofício. Tente recarregar a página.");
    }
}

export const initOccurrenceListeners = () => {
    document.getElementById('add-occurrence-btn').addEventListener('click', () => openOccurrenceModal());

    dom.searchOccurrences.addEventListener('input', (e) => { state.filterOccurrences = e.target.value; renderOccurrences(); });
    dom.occurrenceStartDate.addEventListener('change', (e) => { state.filtersOccurrences.startDate = e.target.value; renderOccurrences(); });
    dom.occurrenceEndDate.addEventListener('change', (e) => { state.filtersOccurrences.endDate = e.target.value; renderOccurrences(); });
    document.getElementById('occurrence-filter-type').addEventListener('change', (e) => { state.filtersOccurrences.type = e.target.value; renderOccurrences(); });
    document.getElementById('occurrence-filter-status').addEventListener('change', (e) => { state.filtersOccurrences.status = e.target.value; renderOccurrences(); });

    dom.generalReportBtn.addEventListener('click', generateAndShowGeneralReport);

    dom.occurrenceForm.addEventListener('submit', handleOccurrenceSubmit);
    dom.followUpForm.addEventListener('submit', handleOccurrenceStepSubmit);

    // LISTENER DE ARQUIVOS
    const fileInput = document.getElementById('follow-up-contact-print');
    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            const files = e.target.files;
            if (!files || files.length === 0) return;

            for (let i = 0; i < files.length; i++) {
                pendingFiles.push(files[i]);
            }

            document.getElementById('follow-up-print-label').textContent = `${pendingFiles.length} Arq.`;
            document.getElementById('follow-up-print-check').classList.remove('hidden');

            renderFilePreviews('follow-up-print-preview');

            fileInput.value = '';
        });
    }

    const sendCtForm = document.getElementById('send-occurrence-ct-form');
    if (sendCtForm) {
        const closeSendCtBtn = document.getElementById('close-send-ct-modal-btn');
        const cancelSendCtBtn = document.getElementById('cancel-send-ct-modal-btn');
        const sendCtModal = document.getElementById('send-occurrence-ct-modal');
        if (closeSendCtBtn && sendCtModal) closeSendCtBtn.onclick = () => closeModal(sendCtModal);
        if (cancelSendCtBtn && sendCtModal) cancelSendCtBtn.onclick = () => closeModal(sendCtModal);
    }

    dom.occurrencesListDiv.addEventListener('click', (e) => {
        window.viewImage = (src, title) => openImageModal(src, title);

        const button = e.target.closest('button');
        if (button) {
            e.stopPropagation();

            const studentIdBtn = button.dataset.studentId;
            const groupIdBtn = button.dataset.groupId;
            const recordIdBtn = button.dataset.recordId;

            if (button.closest('.process-content')) {
                if (button.classList.contains('avancar-etapa-btn') && !button.disabled) {
                    handleNewOccurrenceAction(studentIdBtn, groupIdBtn, recordIdBtn);
                    return;
                }
                if (button.classList.contains('edit-occurrence-action-btn') && !button.disabled) {
                    handleEditOccurrenceAction(studentIdBtn, groupIdBtn, recordIdBtn);
                    return;
                }
                if (button.classList.contains('reset-occurrence-action-btn') && !button.disabled) {
                    handleResetActionConfirmation(studentIdBtn, groupIdBtn, recordIdBtn);
                    return;
                }
                if (button.classList.contains('quick-feedback-btn')) {
                    const action = button.dataset.action;
                    const value = button.dataset.value;
                    handleQuickFeedback(studentIdBtn, groupIdBtn, recordIdBtn, action, value);
                    return;
                }
                if (button.classList.contains('view-notification-btn-hist')) {
                    const attemptNum = button.dataset.attempt;
                    handleGenerateNotification(recordIdBtn, studentIdBtn, groupIdBtn, attemptNum);
                    return;
                }
                if (button.classList.contains('view-occurrence-oficio-btn')) {
                    handleViewOccurrenceOficio(recordIdBtn);
                    return;
                }
            }

            if (button.classList.contains('kebab-menu-btn')) {
                const dropdown = button.nextElementSibling;
                if (dropdown) {
                    document.querySelectorAll('.kebab-menu-dropdown').forEach(d => { if (d !== dropdown) d.classList.add('hidden'); });
                    dropdown.classList.toggle('hidden');
                }
                return;
            }

            const groupId = button.dataset.groupId;
            if (!groupId) return;

            if (button.classList.contains('record-btn')) {
                openOccurrenceRecordModal(groupId);
                return;
            } else if (button.classList.contains('kebab-action-btn')) {
                const action = button.dataset.action;
                if (action === 'edit' && !button.disabled) handleEditOccurrence(groupId);
                else if (action === 'delete' && !button.disabled) handleDelete('occurrence', groupId);
                else if (action === 'history') openHistoryModal(groupId);

                const dropdown = button.closest('.kebab-menu-dropdown');
                if (dropdown) dropdown.classList.add('hidden');
                return;
            }
        }

        const summary = e.target.closest('div.occurrence-summary');
        if (summary) {
            const contentId = summary.dataset.contentId;
            if (!contentId) return;

            const content = document.getElementById(contentId);
            const icon = summary.querySelector('i.fa-chevron-down');
            if (!content) return;

            const isHidden = !content.style.maxHeight || content.style.maxHeight === '0px';
            if (isHidden) {
                content.style.maxHeight = `${content.scrollHeight}px`;
                content.style.overflow = 'visible';
                icon?.classList.add('rotate-180');
            } else {
                content.style.maxHeight = null;
                setTimeout(() => {
                    if (!content.style.maxHeight || content.style.maxHeight === '0px') {
                        content.style.overflow = 'hidden';
                    }
                }, 400);
                icon?.classList.remove('rotate-180');
            }
            return;
        }
    });

    document.querySelectorAll('input[name="follow-up-contact-succeeded"]').forEach(radio =>
        radio.addEventListener('change', (e) => {
            toggleOccurrenceContactFields(e.target.value === 'yes');
        })
    );

    document.querySelectorAll('input[name="follow-up-desfecho-choice"]').forEach(radio =>
        radio.addEventListener('change', (e) => {
            toggleDesfechoFields(e.target.value);
        })
    );

    document.addEventListener('click', (e) => {
        const dropdown = document.getElementById('role-edit-dropdown');
        const isEditButton = e.target.closest('.edit-role-btn');
        if (!dropdown.classList.contains('hidden') && !dropdown.contains(e.target) && !isEditButton) {
            dropdown.classList.add('hidden');
            editingRoleId = null;
        }
    });
};
