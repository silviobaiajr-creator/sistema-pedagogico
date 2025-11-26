// =================================================================================
// ARQUIVO: occurrence.js 
// VERSÃO: 4.0 (Fluxo Estrito de 3 Convocações + Botões Interativos na Lista)

import { state, dom } from './state.js';
import { showToast, openModal, closeModal, getStatusBadge, formatDate, formatTime } from './utils.js';
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

// =================================================================================
// CONFIGURAÇÕES E UTILITÁRIOS LOCAIS
// =================================================================================

// Títulos atualizados para o novo fluxo
export const occurrenceActionTitles = { 
    'convocacao_1': 'Ação 2: 1ª Convocação',
    'feedback_1':   'Ação 3: Feedback da 1ª Tentativa',
    'convocacao_2': 'Ação 2: 2ª Convocação',
    'feedback_2':   'Ação 3: Feedback da 2ª Tentativa',
    'convocacao_3': 'Ação 2: 3ª Convocação',
    'feedback_3':   'Ação 3: Feedback da 3ª Tentativa',
    'desfecho_ou_ct': 'Ação 4 ou 6: Encaminhar ao CT ou Dar Parecer',
    'devolutiva_ct': 'Ação 5: Registrar Devolutiva do CT',
    'parecer_final': 'Ação 6: Dar Parecer Final'
};

let studentPendingRoleSelection = null;
let editingRoleId = null; 
let studentSearchTimeout = null;

const normalizeText = (text) => {
    if (!text) return '';
    return text.toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
};

// =================================================================================
// FUNÇÕES DE INTERFACE (UI) - TAGS E SELEÇÃO
// =================================================================================

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

// =================================================================================
// RENDERIZAÇÃO (LISTA DE OCORRÊNCIAS)
// =================================================================================

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

        const studentAccordionsHTML = [...incident.participantsInvolved.values()]
            .filter(participant => {
                if (studentSearch && !normalizeText(participant.student.name).includes(studentSearch)) {
                    return false;
                }
                return true; 
            })
            .map(participant => {
                const { student, role } = participant;
                if (!student) return '';
                const record = incident.records.find(r => r && r.studentId === student.matricula);
                const recordId = record?.id || '';
                const status = record?.statusIndividual || 'Aguardando Convocação';
                
                const isMatch = studentSearch && normalizeText(student.name).includes(studentSearch);
                const nameClass = isMatch ? 'font-bold text-yellow-800 bg-yellow-100 px-1 rounded' : 'font-medium text-gray-700';
                const iconClass = roleIcons[role] || roleIcons[defaultRole];
                const isIndividualResolvido = record?.statusIndividual === 'Resolvido';

                let historyHtml = '';
                
                // Helper para renderizar bloco de Tentativa
                const renderAttemptBlock = (index, mDate, mTime, succeeded, contactDate) => {
                    if (!mDate) return '';
                    
                    const attemptNum = index; // 1, 2 ou 3
                    const notificationBtn = `
                        <button type="button" class="view-notification-btn-hist text-sky-600 hover:text-sky-900 text-xs font-semibold ml-2 cursor-pointer" 
                                data-record-id="${recordId}" data-student-id="${student.matricula}" data-group-id="${incident.id}" title="Ver Notificação">
                            [<i class="fas fa-eye fa-fw"></i> Ver Notificação]
                        </button>`;
                    
                    let statusContent = '';
                    
                    if (succeeded === null) {
                        // LÓGICA DO BOTÃO INTERATIVO: Pendente de Feedback
                        statusContent = `
                            <div class="mt-1 flex items-center gap-2">
                                <span class="text-xs text-yellow-700 font-medium">Conseguiu contato?</span>
                                <button type="button" class="quick-feedback-btn bg-green-100 text-green-700 hover:bg-green-200 text-xs px-2 py-0.5 rounded border border-green-300 transition"
                                        data-record-id="${recordId}" data-student-id="${student.matricula}" data-group-id="${incident.id}" data-action="feedback_${attemptNum}" data-value="yes">
                                    Sim
                                </button>
                                <button type="button" class="quick-feedback-btn bg-red-100 text-red-700 hover:bg-red-200 text-xs px-2 py-0.5 rounded border border-red-300 transition"
                                        data-record-id="${recordId}" data-student-id="${student.matricula}" data-group-id="${incident.id}" data-action="feedback_${attemptNum}" data-value="no">
                                    Não
                                </button>
                            </div>
                        `;
                    } else if (succeeded === 'yes') {
                        statusContent = `<span class="text-green-600 font-semibold ml-1">- Contato Realizado (${formatDate(contactDate)})</span>`;
                    } else {
                        statusContent = `<span class="text-red-600 font-semibold ml-1">- Sem sucesso</span>`;
                    }

                    return `
                        <div class="mb-2 pb-2 border-b border-gray-100 last:border-0">
                            <p class="text-xs text-gray-700 flex items-center flex-wrap">
                                <i class="fas fa-bullhorn text-gray-400 fa-fw mr-1"></i> 
                                <strong>${attemptNum}ª Convocação:</strong> Agendada p/ ${formatDate(mDate)} às ${formatTime(mTime)}.
                                ${notificationBtn}
                            </p>
                            ${statusContent}
                        </div>`;
                };

                // Renderiza as 3 tentativas possíveis
                // Nota: meetingDate (legacy) é tratado como meetingDate_1
                historyHtml += renderAttemptBlock(1, record.meetingDate || record.meetingDate_1, record.meetingTime || record.meetingTime_1, record.contactSucceeded_1, record.contactDate_1);
                historyHtml += renderAttemptBlock(2, record.meetingDate_2, record.meetingTime_2, record.contactSucceeded_2, record.contactDate_2);
                historyHtml += renderAttemptBlock(3, record.meetingDate_3, record.meetingTime_3, record.contactSucceeded_3, record.contactDate_3);

                // Ações Finais (4, 5, 6)
                if (record?.oficioNumber) {
                     historyHtml += `<p class="text-xs text-gray-600 mt-1"><i class="fas fa-file-export text-blue-500 fa-fw mr-1"></i> <strong>Ação 4 (Enc. CT):</strong> Enviado Ofício Nº ${record.oficioNumber}/${record.oficioYear}.</p>`;
                }
                if (record?.ctFeedback) {
                     historyHtml += `<p class="text-xs text-gray-600 mt-1"><i class="fas fa-reply text-purple-500 fa-fw mr-1"></i> <strong>Ação 5 (Devolutiva):</strong> Recebida.</p>`;
                }
                if (record?.parecerFinal) {
                     historyHtml += `<p class="text-xs text-gray-600 mt-1"><i class="fas fa-flag-checkered text-green-600 fa-fw mr-1"></i> <strong>Ação 6 (Parecer Final):</strong> Processo finalizado.</p>`;
                }
                
                if (historyHtml === '') {
                     historyHtml = `<p class="text-xs text-gray-400 italic">Aguardando início do acompanhamento.</p>`;
                }
                
                const avancarBtn = `
                    <button type="button"
                            class="avancar-etapa-btn text-sky-600 hover:text-sky-900 text-xs font-semibold py-1 px-2 rounded-md bg-sky-50 hover:bg-sky-100 ${isIndividualResolvido ? 'opacity-50 cursor-not-allowed' : ''}"
                            title="${isIndividualResolvido ? 'Processo individual finalizado' : `Agendar próxima etapa`}"
                            ${isIndividualResolvido ? 'disabled' : ''}
                            data-group-id="${incident.id}"
                            data-student-id="${student.matricula}"
                            data-record-id="${recordId}">
                        <i class="fas fa-plus"></i> Avançar / Agendar
                    </button>
                `;

                const viewOficioBtn = record?.oficioNumber ? `
                    <button type="button"
                            class="view-occurrence-oficio-btn text-green-600 hover:text-green-900 text-xs font-semibold py-1 px-2 rounded-md bg-green-50 hover:bg-green-100"
                            data-record-id="${recordId}"
                            title="Ver Ofício Nº ${record.oficioNumber}/${record.oficioYear || ''}">
                        <i class="fas fa-file-alt"></i> Ver Ofício
                    </button>
                ` : '';

                const editActionBtn = `
                    <button type="button"
                            class="edit-occurrence-action-btn text-yellow-600 hover:text-yellow-900 text-xs font-semibold py-1 px-2 rounded-md bg-yellow-50 hover:bg-yellow-100 ${isFinalizada ? 'opacity-50 cursor-not-allowed' : ''}"
                            data-group-id="${incident.id}"
                            data-student-id="${student.matricula}"
                            data-record-id="${recordId}"
                            ${isFinalizada ? 'disabled' : ''}
                            title="Editar a última ação salva">
                        <i class="fas fa-pencil-alt"></i> Editar Última
                    </button>
                `;
                
                const resetActionBtn = `
                     <button type="button"
                            class="reset-occurrence-action-btn text-red-600 hover:text-red-900 text-xs font-semibold py-1 px-2 rounded-md bg-red-50 hover:bg-red-100 ${isFinalizada ? 'opacity-50 cursor-not-allowed' : ''}"
                            data-group-id="${incident.id}"
                            data-student-id="${student.matricula}"
                            data-record-id="${recordId}"
                            ${isFinalizada ? 'disabled' : ''}
                            title="Limpar a última ação (desfazer)">
                        <i class="fas fa-undo-alt"></i> Limpar
                    </button>
                `;
                
                const contentId = `occ-content-${recordId || student.matricula}`; 
                
                return `
                    <div class="bg-gray-50 rounded-lg border border-gray-200">
                        <div class="occurrence-summary p-3 cursor-pointer hover:bg-sky-50 flex justify-between items-center"
                             data-content-id="${contentId}">
                            
                            <div class="flex items-center gap-2">
                                <i class="${iconClass} fa-fw w-4 text-center" title="${role}"></i>
                                <span class="${nameClass}">${student.name}</span>
                                <span class="text-xs text-gray-500">(${role})</span>
                                ${getStatusBadge(status)}
                            </div>
                            <i class="fas fa-chevron-down transition-transform duration-300 text-gray-400"></i>
                        </div>
                        
                        <div id="${contentId}" class="process-content" style="max-height: 0px; overflow: hidden;">
                            <div class="p-3 border-t border-gray-200 bg-white">
                                <h5 class="text-xs font-bold uppercase text-gray-500 mb-2">Histórico de Ações</h5>
                                <div class="space-y-2 mb-3">
                                    ${historyHtml}
                                </div>
                                <h5 class="text-xs font-bold uppercase text-gray-500 mb-2 mt-4">Gestão</h5>
                                <div class="flex items-center flex-wrap gap-2">
                                    ${avancarBtn}
                                    ${editActionBtn}
                                    ${resetActionBtn}
                                    ${viewOficioBtn}
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');

        return `
            <div class="border rounded-lg bg-white shadow-sm">
                <div class="p-4 flex flex-col sm:flex-row justify-between items-start gap-3">
                    <div class="flex-grow">
                        <div class="flex items-center gap-3 mb-2">
                            <span class="font-semibold text-gray-800">${mainRecord.occurrenceType || 'N/A'}</span>
                            ${getStatusBadge(incident.overallStatus)}
                        </div>
                        <div class="text-sm text-gray-600 mt-2">
                            <strong class="block text-gray-500 text-xs font-bold uppercase mb-1.5">Alunos Envolvidos:</strong>
                            <div class="space-y-2">${studentAccordionsHTML}</div>
                        </div>
                        <p class="text-xs text-gray-400 mt-2">Data: ${formatDate(mainRecord.date)} | ID: ${incident.id}</p>
                    </div>
                    <div class="flex-shrink-0 flex flex-col sm:flex-row items-stretch sm:items-center gap-2 self-stretch sm:self-center">
                        <button class="kebab-action-btn text-gray-600 hover:text-gray-900 text-xs font-semibold py-2 px-3 rounded-md bg-gray-50 hover:bg-gray-100 border border-gray-300 text-center ${isFinalizada ? 'opacity-50 cursor-not-allowed' : ''}"
                                data-action="edit" data-group-id="${incident.id}" title="Editar Fato (Ação 1)" ${isFinalizada ? 'disabled' : ''}>
                           <i class="fas fa-pencil-alt mr-1"></i> Editar Fato
                        </button>
                        <button class="record-btn text-gray-600 hover:text-gray-900 text-xs font-semibold py-2 px-3 rounded-md bg-gray-50 hover:bg-gray-100 border border-gray-300 text-center" data-group-id="${incident.id}" title="Gerar Ata de Ocorrência">
                            <i class="fas fa-file-invoice mr-1"></i> Gerar Ata
                        </button>
                        <div class="relative kebab-menu-container self-center">
                            <button class="kebab-menu-btn text-gray-500 hover:text-gray-800 p-2 rounded-full hover:bg-gray-100" data-group-id="${incident.id}" title="Mais Opções">
                                <i class="fas fa-ellipsis-v"></i>
                            </button>
                            <div class="kebab-menu-dropdown hidden absolute right-0 mt-1 w-48 bg-white rounded-md shadow-lg border z-10">
                                <button class="kebab-action-btn menu-item w-full text-left" data-action="history" data-group-id="${incident.id}"><i class="fas fa-history mr-2 w-4"></i>Histórico</button>
                                <button class="kebab-action-btn menu-item menu-item-danger w-full text-left ${isFinalizada ? 'opacity-50 cursor-not-allowed' : ''}"
                                        data-action="delete" data-group-id="${incident.id}" ${isFinalizada ? 'disabled' : ''}>
                                    <i class="fas fa-trash mr-2 w-4"></i>Excluir
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>`;
    }).join('');
    dom.occurrencesListDiv.innerHTML = html;
};


// =================================================================================
// MODAIS - AÇÃO 1 (FATO COLETIVO)
// =================================================================================

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

// =================================================================================
// MODAIS - AÇÕES 2-6 (ACOMPANHAMENTO INDIVIDUAL)
// =================================================================================

const toggleOccurrenceContactFields = (enable) => {
    const fieldsContainer = document.getElementById('group-contato-fields');
    if (!fieldsContainer) return;

    fieldsContainer.classList.toggle('hidden', !enable);
    const detailFields = fieldsContainer.querySelectorAll('select, input[type="date"], textarea');

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


export const openOccurrenceStepModal = (student, record, actionType, preFilledData = null) => {
    const followUpForm = document.getElementById('follow-up-form');
    followUpForm.reset();
    followUpForm.dataset.recordId = record.id;
    followUpForm.dataset.studentId = student.matricula;
    followUpForm.dataset.actionType = actionType;

    document.getElementById('follow-up-student-name').value = student.name;

    const statusDisplay = document.getElementById('follow-up-status-display');
    const modalTitle = document.getElementById('follow-up-modal-title');
    
    modalTitle.textContent = occurrenceActionTitles[actionType] || 'Acompanhamento Individual';
    statusDisplay.innerHTML = `<strong>Status:</strong> ${getStatusBadge(record.statusIndividual || 'Aguardando Convocação')}`;

    // Ocultar fieldset de identificação do aluno para layout enxuto
    const studentInfoBlock = document.querySelector('#follow-up-form fieldset:first-of-type');
    if (studentInfoBlock) studentInfoBlock.classList.add('hidden');

    ['follow-up-meeting-date', 'follow-up-contact-date', 'follow-up-ct-sent-date'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.removeAttribute('min');
    });

    document.querySelectorAll('.dynamic-occurrence-step').forEach(group => {
        group.classList.add('hidden');
        group.querySelectorAll('input, select, textarea, button').forEach(el => {
            el.disabled = true;
            el.required = false;
        });
        group.querySelectorAll('input[type="radio"]').forEach(radio => radio.checked = false);
    });
    toggleDesfechoFields(null); 
    toggleOccurrenceContactFields(false);

    let currentGroup = null;

    // --- LÓGICA DE ABERTURA BASEADA NO TIPO DE AÇÃO ---

    if (actionType.startsWith('convocacao_')) { 
        // Ação 2: Agendar Convocação (1, 2 ou 3)
        const attemptNum = actionType.split('_')[1];
        
        currentGroup = document.getElementById('group-convocacao');
        if (currentGroup) {
            currentGroup.classList.remove('hidden');
            currentGroup.querySelector('legend').textContent = `Ação 2: Agendar ${attemptNum}ª Convocação`;
            
            const dateInput = document.getElementById('follow-up-meeting-date');
            const timeInput = document.getElementById('follow-up-meeting-time');
            
            // Tenta carregar dados existentes para edição
            const existingDate = record[`meetingDate_${attemptNum}`] || (attemptNum == 1 ? record.meetingDate : null);
            const existingTime = record[`meetingTime_${attemptNum}`] || (attemptNum == 1 ? record.meetingTime : null);
            
            dateInput.value = existingDate || '';
            timeInput.value = existingTime || '';
            dateInput.disabled = false; dateInput.required = true;
            timeInput.disabled = false; timeInput.required = true;
            
            // Define data mínima baseada na etapa anterior
            if (attemptNum == 1) {
                if(record.date) dateInput.min = record.date;
            } else {
                const prevAttempt = attemptNum - 1;
                const prevDate = record[`meetingDate_${prevAttempt}`] || (prevAttempt == 1 ? record.meetingDate : null);
                if (prevDate) dateInput.min = prevDate;
            }
        }

    } else if (actionType.startsWith('feedback_')) { 
        // Ação 3: Feedback (1, 2 ou 3)
        const attemptNum = parseInt(actionType.split('_')[1]);
        
        currentGroup = document.getElementById('group-contato');
        if (currentGroup) {
            currentGroup.classList.remove('hidden');
            const legend = document.getElementById('legend-contato');
            if (legend) legend.textContent = `Ação 3: Feedback da ${attemptNum}ª Tentativa`;

            const radios = currentGroup.querySelectorAll('input[name="follow-up-contact-succeeded"]');
            radios.forEach(r => { r.disabled = false; r.required = true; });

            // Se vier pré-preenchido do botão rápido
            if (preFilledData && preFilledData.succeeded) {
                const radio = currentGroup.querySelector(`input[value="${preFilledData.succeeded}"]`);
                if(radio) radio.checked = true;
                toggleOccurrenceContactFields(preFilledData.succeeded === 'yes');
            } else {
                // Carrega do banco para edição
                const currentSucceededValue = record[`contactSucceeded_${attemptNum}`]; 
                const radioChecked = document.querySelector(`input[name="follow-up-contact-succeeded"][value="${currentSucceededValue}"]`);
                if (radioChecked) radioChecked.checked = true;
                toggleOccurrenceContactFields(currentSucceededValue === 'yes');
            }
            
            document.getElementById('follow-up-contact-type').value = record[`contactType_${attemptNum}`] || '';
            const contactDateInput = document.getElementById('follow-up-contact-date');
            contactDateInput.value = record[`contactDate_${attemptNum}`] || '';
            
            // Data mínima = Data da Convocação correspondente
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
        if(oficioInput) oficioInput.value = record.oficioNumber || '';
        if(dateCtInput) dateCtInput.value = record.ctSentDate || '';
        if(parecerInput) parecerInput.value = record.parecerFinal || '';
        
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


// =================================================================================
// HANDLERS DE SUBMISSÃO (SALVAR)
// =================================================================================

async function handleOccurrenceSubmit(e) {
    e.preventDefault();
    const form = e.target;
    if (!form.checkValidity()) {
        form.reportValidity();
        showToast("Por favor, preencha todos os campos obrigatórios (*).");
        return;
    }

    const groupId = document.getElementById('occurrence-group-id').value;
    if (state.selectedStudents.size === 0) return showToast("Selecione pelo menos um aluno.");

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
        return showToast("Erro: A data da ocorrência não pode ser no futuro.");
    }

    if (!collectiveData.providenciasEscola) {
        showToast("O campo 'Providências da Escola' é obrigatório.");
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
                        contactSucceeded_1: null, contactType_1: null, contactDate_1: null, providenciasFamilia_1: null,
                        contactSucceeded_2: null, contactType_2: null, contactDate_2: null, providenciasFamilia_2: null,
                        contactSucceeded_3: null, contactType_3: null, contactDate_3: null, providenciasFamilia_3: null,
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
                    contactSucceeded_1: null, contactType_1: null, contactDate_1: null, providenciasFamilia_1: null,
                    contactSucceeded_2: null, contactType_2: null, contactDate_2: null, providenciasFamilia_2: null,
                    contactSucceeded_3: null, contactType_3: null, contactDate_3: null, providenciasFamilia_3: null,
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
        showToast('Erro ao salvar a ocorrência.');
    }
}


async function handleOccurrenceStepSubmit(e) {
    e.preventDefault();
    const form = e.target;
    if (!form.checkValidity()) {
        form.reportValidity();
        return showToast('Por favor, preencha todos os campos obrigatórios (*).');
    }

    const recordId = form.dataset.recordId;
    const actionType = form.dataset.actionType;
    if (!recordId || !actionType) return showToast("Erro: ID do registro ou tipo de ação não encontrado.");

    const record = state.occurrences.find(r => r.id === recordId);
    if (!record) return showToast("Erro: Registro original não encontrado.");

    let dataToUpdate = {};
    let historyAction = "";
    let nextStatus = record.statusIndividual; 

    try {
        if (actionType.startsWith('convocacao_')) {
            const attemptNum = actionType.split('_')[1];
            // Mapeia para campos do banco (1 usa meetingDate legacy, outros usam sufixo)
            const dateField = attemptNum == 1 ? 'meetingDate' : `meetingDate_${attemptNum}`;
            const timeField = attemptNum == 1 ? 'meetingTime' : `meetingTime_${attemptNum}`;

            const inputDate = document.getElementById('follow-up-meeting-date').value;
            const inputTime = document.getElementById('follow-up-meeting-time').value;

            if (!inputDate || !inputTime) return showToast('Data e Horário obrigatórios.');
            
            const dateCheck = validateOccurrenceChronology(record, actionType, inputDate);
            if (!dateCheck.isValid) return showToast(dateCheck.message);

            dataToUpdate = {
                [dateField]: inputDate,
                [timeField]: inputTime
            };

            historyAction = `Ação 2 (${attemptNum}ª Convocação) agendada para ${formatDate(inputDate)} às ${formatTime(inputTime)}.`;
            nextStatus = `Aguardando Feedback ${attemptNum}`; 

        } else if (actionType.startsWith('feedback_')) {
            const attemptNum = parseInt(actionType.split('_')[1]);
            const contactSucceededRadio = document.querySelector('input[name="follow-up-contact-succeeded"]:checked');
            const contactSucceeded = contactSucceededRadio ? contactSucceededRadio.value : null;

            if (!contactSucceeded) return showToast('Selecione se conseguiu contato.');

            const fields = {
                succeeded: `contactSucceeded_${attemptNum}`,
                type: `contactType_${attemptNum}`,
                date: `contactDate_${attemptNum}`,
                providencias: `providenciasFamilia_${attemptNum}`
            };

            if (contactSucceeded === 'yes') {
                 dataToUpdate = {
                    [fields.succeeded]: 'yes',
                    [fields.type]: document.getElementById('follow-up-contact-type').value,
                    [fields.date]: document.getElementById('follow-up-contact-date').value,
                    [fields.providencias]: document.getElementById('follow-up-family-actions').value,
                };
                if (!dataToUpdate[fields.type] || !dataToUpdate[fields.date] || !dataToUpdate[fields.providencias]) {
                     return showToast('Preencha Tipo, Data e Providências.');
                }
                
                const dateCheck = validateOccurrenceChronology(record, actionType, dataToUpdate[fields.date]);
                if (!dateCheck.isValid) return showToast(dateCheck.message);

                historyAction = `Ação 3 (Feedback da ${attemptNum}ª Tentativa): Contato realizado com sucesso.`;
                nextStatus = 'Aguardando Desfecho'; 

            } else { 
                dataToUpdate = {
                    [fields.succeeded]: 'no',
                    [fields.type]: null, [fields.date]: null, [fields.providencias]: null, 
                };
                historyAction = `Ação 3 (Feedback da ${attemptNum}ª Tentativa): Contato sem sucesso.`;
                
                // Define próxima etapa baseada na tentativa atual
                if (attemptNum === 1) nextStatus = 'Aguardando Convocação 2';
                else if (attemptNum === 2) nextStatus = 'Aguardando Convocação 3';
                else nextStatus = 'Aguardando Desfecho'; // Esgotou tentativas, vai para desfecho
            }

        } else if (actionType === 'desfecho_ou_ct') {
            const desfechoChoiceRadio = document.querySelector('input[name="follow-up-desfecho-choice"]:checked');
            const desfechoChoice = desfechoChoiceRadio ? desfechoChoiceRadio.value : null;

            if (!desfechoChoice) return showToast("Erro: Escolha uma opção.");

            if (desfechoChoice === 'ct') {
                const oficioNumber = document.getElementById('follow-up-oficio-number').value.trim();
                const ctSentDate = document.getElementById('follow-up-ct-sent-date').value;

                if (!oficioNumber || !ctSentDate) return showToast("Erro: Preencha o Ofício e Data.");

                const dateCheck = validateOccurrenceChronology(record, 'desfecho_ou_ct', ctSentDate);
                if (!dateCheck.isValid) return showToast(dateCheck.message);

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
                 if (!parecerFinal) return showToast("Erro: Preencha o Parecer.");
                 
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
             if (!dataToUpdate.ctFeedback) return showToast("Erro: Preencha a Devolutiva.");
            historyAction = `Ação 5 (Devolutiva do CT) registrada.`;
            nextStatus = 'Aguardando Parecer Final';

        } else if (actionType === 'parecer_final') { 
            dataToUpdate = {
                parecerFinal: document.getElementById('follow-up-parecer-final').value.trim(),
            };
             if (!dataToUpdate.parecerFinal) return showToast("Erro: Preencha o Parecer final.");
            historyAction = `Ação 6 (Parecer Final) registrada após devolutiva do CT.`;
            nextStatus = 'Resolvido'; 
        }

    } catch (collectError) {
        console.error("Erro ao coletar dados:", collectError);
        showToast("Erro ao processar dados.");
        return;
    }

    dataToUpdate.statusIndividual = nextStatus;

    try {
        await updateRecordWithHistory('occurrence', recordId, dataToUpdate, historyAction, state.userEmail);
        showToast("Etapa salva com sucesso!");

        const studentId = form.dataset.studentId;
        const student = state.students.find(s => s.matricula === studentId);

        // Se foi um encaminhamento ao CT, abrimos o ofício automaticamente
        if (actionType === 'desfecho_ou_ct' && dataToUpdate.desfechoChoice === 'ct') {
             if(student) {
                 generateAndShowOccurrenceOficio({ ...record, ...dataToUpdate }, student, dataToUpdate.oficioNumber, dataToUpdate.oficioYear);
             }
        }

        // Se foi um agendamento de convocação, abre notificação
        if (actionType.startsWith('convocacao_') && student) {
            const incident = await fetchIncidentById(record.occurrenceGroupId);
            const updatedRecordForNotification = { ...record, ...dataToUpdate };
            if (incident) {
                // Atualiza localmente para notificação imediata
                const recordIndex = incident.records.findIndex(r => r.id === recordId);
                if (recordIndex > -1) incident.records[recordIndex] = updatedRecordForNotification;
                else incident.records.push(updatedRecordForNotification);
                
                openIndividualNotificationModal(incident, student);
            }
        } 
        
        closeModal(dom.followUpModal);

    } catch (error) {
        console.error("Erro ao salvar etapa:", error);
        showToast('Erro ao salvar a etapa.');
    }
}


async function handleEditOccurrence(groupId) {
    const incident = await fetchIncidentById(groupId);
    if (incident) {
        if (incident.overallStatus === 'Finalizada') return showToast('Ocorrência finalizada. Não é possível editar.');
        openOccurrenceModal(incident); 
    } else {
        showToast('Incidente não encontrado.');
    }
}

async function handleEditOccurrenceAction(studentId, groupId, recordId) {
    const incident = await fetchIncidentById(groupId);
    if (!incident) return showToast('Erro: Incidente não encontrado.');
    if (incident.overallStatus === 'Finalizada') return showToast('Ocorrência finalizada. Não é possível editar.');

    const participantData = incident.participantsInvolved.get(studentId);
    const student = participantData?.student;
    if (!student) return showToast('Erro: Aluno não encontrado.');

    const record = incident.records.find(r => r.id === recordId);
    if (!record) return showToast('Erro: Registro não encontrado.');

    let actionToEdit = determineCurrentActionFromStatus(record.statusIndividual);
    
    // Fallback: Se actionToEdit retornar nulo ou não for específico o suficiente,
    // a função determineCurrentActionFromStatus já deve tratar, mas garantimos aqui que abra algo.
    if (!actionToEdit) {
        return showToast('Estado inválido para edição direta.');
    }
    
    openOccurrenceStepModal(student, record, actionToEdit);
}

async function handleResetActionConfirmation(studentId, groupId, recordId) {
    const incident = await fetchIncidentById(groupId);
    if (!incident) return showToast('Erro: Incidente não encontrado.');
    if (incident.overallStatus === 'Finalizada') return showToast('Ocorrência finalizada. Não é possível limpar.');
    
    const record = incident.records.find(r => r.id === recordId);
    if (!record) return showToast('Erro: Registro não encontrado.');
    
    let actionToReset = determineCurrentActionFromStatus(record.statusIndividual);

    if (actionToReset === null) {
        return showToast('Não é possível Limpar a Ação 1 (Fato). Use "Editar Fato".');
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
    // A validação de 'Finalizada' já é feita visualmente no botão, mas adicionamos aqui por segurança
    const incident = state.occurrences.find(occ => occ.occurrenceGroupId === id || occ.id === id); // Procura simplificada para validar status localmente
    // Para validação mais robusta seria necessário fetchIncidentById, mas a UI já bloqueia.
    // Se quiser estrito, adicione aqui.
    
    document.getElementById('delete-confirm-message').textContent = 'Tem certeza que deseja excluir este incidente e todos os seus registros associados?';
    state.recordToDelete = { type, id };
    openModal(dom.deleteConfirmModal);
}

// Handler para o botão "Avançar"
async function handleNewOccurrenceAction(studentId, groupId, recordId) {
    const incident = await fetchIncidentById(groupId); 
    if (!incident) return showToast('Erro: Incidente não encontrado.');

    const participantData = incident.participantsInvolved.get(studentId);
    const student = participantData?.student;
    if (!student) return showToast('Erro: Aluno não encontrado.');

    const record = incident.records.find(r => r.id === recordId);
    if (!record) return showToast('Erro: Registro não encontrado.');

    const nextAction = determineNextOccurrenceStep(record.statusIndividual);

    if (nextAction === null) {
        showToast('Processo finalizado. Use "Editar Ação" ou "Limpar Ação".');
        return;
    }
    openOccurrenceStepModal(student, record, nextAction);
}

// Handler para botões rápidos de feedback (Sim/Não) na lista
async function handleQuickFeedback(studentId, groupId, recordId, actionType, value) {
    const incident = await fetchIncidentById(groupId); 
    if (!incident) return showToast('Erro: Incidente não encontrado.');

    const participantData = incident.participantsInvolved.get(studentId);
    const student = participantData?.student;
    if (!student) return showToast('Erro: Aluno não encontrado.');

    const record = incident.records.find(r => r.id === recordId);
    if (!record) return showToast('Erro: Registro não encontrado.');

    // Abre o modal de feedback pre-preenchido
    openOccurrenceStepModal(student, record, actionType, { succeeded: value });
}


async function handleGenerateNotification(recordId, studentId, groupId) {
    const incident = await fetchIncidentById(groupId); 
     if (!incident) return showToast('Erro: Incidente não encontrado.');

    const participantData = incident.participantsInvolved.get(studentId);
    const student = participantData?.student;
    if (!student) return showToast('Erro: Aluno não encontrado.');

    openIndividualNotificationModal(incident, student);
}

async function handleViewOccurrenceOficio(recordId) {
    try {
        if (!recordId) return;
        let targetRecord = null; let targetIncident = null;

        const recordFromState = state.occurrences.find(r => r.id === recordId);
        if (!recordFromState || !recordFromState.occurrenceGroupId) {
             return showToast('Registro não encontrado localmente.');
        }

        targetIncident = await fetchIncidentById(recordFromState.occurrenceGroupId);
        if (!targetIncident) return showToast('Incidente não encontrado no servidor.');

        targetRecord = targetIncident.records.find(r => r.id === recordId);
        if (!targetRecord) return showToast('Registro específico não encontrado.'); 

        if (!targetRecord.oficioNumber) return showToast('Este registro não possui um ofício associado.');

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
        showToast("Erro interno ao abrir o ofício. Tente recarregar a página.");
    }
}


// =================================================================================
// INICIALIZAÇÃO DOS LISTENERS
// =================================================================================

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
    
    const sendCtForm = document.getElementById('send-occurrence-ct-form');
    if (sendCtForm) {
        const closeSendCtBtn = document.getElementById('close-send-ct-modal-btn');
        const cancelSendCtBtn = document.getElementById('cancel-send-ct-modal-btn');
        const sendCtModal = document.getElementById('send-occurrence-ct-modal');
        if (closeSendCtBtn && sendCtModal) closeSendCtBtn.onclick = () => closeModal(sendCtModal);
        if (cancelSendCtBtn && sendCtModal) cancelSendCtBtn.onclick = () => closeModal(sendCtModal);
    }

    dom.occurrencesListDiv.addEventListener('click', (e) => {
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
                // Handler para os novos botões rápidos de feedback
                if (button.classList.contains('quick-feedback-btn')) {
                    const action = button.dataset.action;
                    const value = button.dataset.value;
                    handleQuickFeedback(studentIdBtn, groupIdBtn, recordIdBtn, action, value);
                    return;
                }
                if (button.classList.contains('view-notification-btn-hist')) {
                     handleGenerateNotification(recordIdBtn, studentIdBtn, groupIdBtn);
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
                if(dropdown) dropdown.classList.add('hidden');
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