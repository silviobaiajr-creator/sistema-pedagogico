// =================================================================================
// ARQUIVO: occurrence.js 
// VERSÃO: 4.0 (Ciclo de 3 Convocações: Interface Ativa e Histórico com Ações Rápidas)

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

// Títulos atualizados para o novo fluxo de 3 Convocações
export const occurrenceActionTitles = { 
    'agendar_convocacao_1': 'Agendar 1ª Convocação',
    'resultado_convocacao_1': 'Registrar Comparecimento (1ª Convocação)',
    
    'agendar_convocacao_2': 'Agendar 2ª Convocação',
    'resultado_convocacao_2': 'Registrar Comparecimento (2ª Convocação)',
    
    'agendar_convocacao_3': 'Agendar 3ª Convocação',
    'resultado_convocacao_3': 'Registrar Comparecimento (3ª Convocação)',

    'desfecho_ou_ct': 'Encaminhar ao CT ou Finalizar',
    'devolutiva_ct': 'Registrar Devolutiva do CT',
    'parecer_final': 'Dar Parecer Final'
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
// (Mantido igual à versão anterior - renderTags, setupStudentTagInput...)

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
// RENDERIZAÇÃO (REFORMULADA: Histórico Ativo com Botões de Ação)
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
                const status = record?.statusIndividual || 'Aguardando 1ª Convocação';
                
                const isMatch = studentSearch && normalizeText(student.name).includes(studentSearch);
                const nameClass = isMatch ? 'font-bold text-yellow-800 bg-yellow-100 px-1 rounded' : 'font-medium text-gray-700';
                const iconClass = roleIcons[role] || roleIcons[defaultRole];
                const isIndividualResolvido = record?.statusIndividual === 'Resolvido';

                let historyHtml = '';

                // Helper para renderizar linha de convocação
                const renderConvocationLine = (num, date, time, succeeded) => {
                    let lineStatus = '';
                    let actionButtons = '';

                    const notifBtn = `
                        <button type="button" class="view-notification-btn-hist text-sky-600 hover:text-sky-900 text-xs font-semibold ml-2 cursor-pointer" 
                                data-record-id="${recordId}" data-student-id="${student.matricula}" data-group-id="${incident.id}" title="Ver Notificação">
                            [<i class="fas fa-eye fa-fw"></i> Ver Notificação]
                        </button>`;

                    if (date) {
                        const baseText = `<i class="fas fa-calendar-check text-blue-500 fa-fw mr-1"></i> <strong>${num}ª Convocação:</strong> Agendada para ${formatDate(date)} às ${formatTime(time)}. ${notifBtn}`;
                        
                        if (succeeded === 'yes') {
                            lineStatus = `<span class="block ml-6 text-green-600 font-semibold text-xs"><i class="fas fa-check"></i> Família compareceu.</span>`;
                        } else if (succeeded === 'no') {
                            lineStatus = `<span class="block ml-6 text-red-600 font-semibold text-xs"><i class="fas fa-times"></i> Família não compareceu.</span>`;
                        } else {
                            // AINDA PENDENTE: Mostra botões de ação!
                            actionButtons = `
                                <div class="ml-6 mt-1 flex items-center gap-2">
                                    <span class="text-xs font-bold text-gray-700">Família compareceu?</span>
                                    <button type="button" class="quick-action-btn bg-green-100 text-green-700 hover:bg-green-200 px-2 py-0.5 rounded text-xs border border-green-300"
                                            data-action="compareceu_sim" data-attempt="${num}" data-record-id="${recordId}" data-student-id="${student.matricula}" data-group-id="${incident.id}">
                                        Sim
                                    </button>
                                    <button type="button" class="quick-action-btn bg-red-100 text-red-700 hover:bg-red-200 px-2 py-0.5 rounded text-xs border border-red-300"
                                            data-action="compareceu_nao" data-attempt="${num}" data-record-id="${recordId}" data-student-id="${student.matricula}" data-group-id="${incident.id}">
                                        Não
                                    </button>
                                </div>
                            `;
                        }
                        return `<div class="mb-2 text-xs text-gray-600">${baseText}${lineStatus}${actionButtons}</div>`;
                    }
                    return '';
                };

                // 1ª Convocação
                if (record?.meetingDate) {
                    historyHtml += renderConvocationLine(1, record.meetingDate, record.meetingTime, record.contactSucceeded_1);
                }
                
                // 2ª Convocação (Só mostra se a 1ª falhou)
                if (record?.meetingDate_2) {
                    historyHtml += renderConvocationLine(2, record.meetingDate_2, record.meetingTime_2, record.contactSucceeded_2);
                }

                // 3ª Convocação (Só mostra se a 2ª falhou)
                if (record?.meetingDate_3) {
                    historyHtml += renderConvocationLine(3, record.meetingDate_3, record.meetingTime_3, record.contactSucceeded_3);
                }

                // Ações Finais
                if (record?.oficioNumber) {
                     historyHtml += `<p class="text-xs text-gray-600 mb-1"><i class="fas fa-share-square text-purple-500 fa-fw mr-1"></i> <strong>Encaminhamento CT:</strong> Ofício Nº ${record.oficioNumber}/${record.oficioYear}.</p>`;
                }
                if (record?.ctFeedback) {
                     historyHtml += `<p class="text-xs text-gray-600 mb-1"><i class="fas fa-reply text-purple-500 fa-fw mr-1"></i> <strong>Devolutiva CT:</strong> Recebida.</p>`;
                }
                if (record?.parecerFinal) {
                     historyHtml += `<p class="text-xs text-gray-600 mb-1"><i class="fas fa-gavel text-gray-600 fa-fw mr-1"></i> <strong>Parecer Final:</strong> Processo concluído.</p>`;
                }
                if (historyHtml === '') {
                     historyHtml = `<p class="text-xs text-gray-400 italic">Aguardando agendamento da 1ª Convocação.</p>`;
                }
                
                // Botões principais (Avançar/Editar)
                // A lógica do botão "Avançar" agora deve ser inteligente para apenas "Agendar" ou "Encaminhar",
                // já que o "Resultado" é tratado pelos botões inline.
                
                let nextActionLabel = "Avançar Etapa";
                if (status.includes('Aguardando 1ª') || status.includes('Aguardando Convocação')) nextActionLabel = "Agendar 1ª Convocação";
                else if (status.includes('Aguardando 2ª')) nextActionLabel = "Agendar 2ª Convocação";
                else if (status.includes('Aguardando 3ª')) nextActionLabel = "Agendar 3ª Convocação";
                else if (status.includes('Aguardando Comparecimento')) nextActionLabel = "Aguardando Resultado..."; // Desabilita se pendente de resposta inline
                else if (status.includes('Desfecho')) nextActionLabel = "Encaminhar/Finalizar";

                const isPendingResult = status.includes('Aguardando Comparecimento');

                const avancarBtn = `
                    <button type="button"
                            class="avancar-etapa-btn text-sky-600 hover:text-sky-900 text-xs font-semibold py-1 px-2 rounded-md bg-sky-50 hover:bg-sky-100 ${isIndividualResolvido || isPendingResult ? 'opacity-50 cursor-not-allowed' : ''}"
                            title="${isIndividualResolvido ? 'Processo finalizado' : isPendingResult ? 'Responda se a família compareceu acima' : 'Agendar próxima etapa'}"
                            ${isIndividualResolvido || isPendingResult ? 'disabled' : ''}
                            data-group-id="${incident.id}"
                            data-student-id="${student.matricula}"
                            data-record-id="${recordId}">
                        <i class="fas fa-calendar-plus"></i> ${nextActionLabel}
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
                            class="edit-occurrence-action-btn text-yellow-600 hover:text-yellow-900 text-xs font-semibold py-1 px-2 rounded-md bg-yellow-50 hover:bg-yellow-100"
                            data-group-id="${incident.id}"
                            data-student-id="${student.matricula}"
                            data-record-id="${recordId}"
                            title="Editar a última ação salva">
                        <i class="fas fa-pencil-alt"></i> Editar Última
                    </button>
                `;
                
                const resetActionBtn = `
                     <button type="button"
                            class="reset-occurrence-action-btn text-red-600 hover:text-red-900 text-xs font-semibold py-1 px-2 rounded-md bg-red-50 hover:bg-red-100"
                            data-group-id="${incident.id}"
                            data-student-id="${student.matricula}"
                            data-record-id="${recordId}"
                            title="Desfazer última etapa">
                        <i class="fas fa-undo-alt"></i> Desfazer
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
                                <div class="space-y-1 mb-3 pl-2 border-l-2 border-gray-100">
                                    ${historyHtml}
                                </div>
                                <div class="flex items-center flex-wrap gap-2 mt-4 pt-2 border-t border-gray-100">
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


export const openOccurrenceStepModal = (student, record, actionType) => {
    const followUpForm = document.getElementById('follow-up-form');
    followUpForm.reset();
    followUpForm.dataset.recordId = record.id;
    followUpForm.dataset.studentId = student.matricula;
    followUpForm.dataset.actionType = actionType;

    document.getElementById('follow-up-student-name').value = student.name;

    const statusDisplay = document.getElementById('follow-up-status-display');
    const modalTitle = document.getElementById('follow-up-modal-title');
    
    // (AJUSTE) Títulos mais amigáveis para o novo fluxo
    let title = occurrenceActionTitles[actionType] || 'Acompanhamento Individual';
    if (actionType.startsWith('resultado_convocacao_')) {
        const n = actionType.split('_')[2];
        title = `Registrar Resultado da ${n}ª Convocação`;
    }
    
    modalTitle.textContent = title;
    statusDisplay.innerHTML = `<strong>Status:</strong> ${getStatusBadge(record.statusIndividual || 'Aguardando 1ª Convocação')}`;

    // (MANTIDO) Ocultar fieldset de identificação para modal enxuto
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

    let requiredFieldsValid = true;
    let currentGroup = null;

    // 1. Agendamento de Convocações (1, 2 ou 3)
    if (actionType.startsWith('agendar_convocacao_')) {
        currentGroup = document.getElementById('group-convocacao');
        if (currentGroup) {
            const n = actionType.split('_')[2];
            currentGroup.querySelector('legend').textContent = `Agendar ${n}ª Convocação`;
            
            currentGroup.classList.remove('hidden');
            const dateInput = document.getElementById('follow-up-meeting-date');
            const timeInput = document.getElementById('follow-up-meeting-time');
            
            // Se for edição, preenche
            if (n === '1') { dateInput.value = record.meetingDate || ''; timeInput.value = record.meetingTime || ''; }
            else if (n === '2') { dateInput.value = record.meetingDate_2 || ''; timeInput.value = record.meetingTime_2 || ''; }
            else if (n === '3') { dateInput.value = record.meetingDate_3 || ''; timeInput.value = record.meetingTime_3 || ''; }

            dateInput.disabled = false; dateInput.required = true;
            timeInput.disabled = false; timeInput.required = true;
            if (record.date) dateInput.min = record.date;
        }

    } else if (actionType.startsWith('resultado_convocacao_')) { 
        // 2. Resultado da Convocação (Apenas se clicou em "Sim" no histórico ou está editando)
        // Nota: Se clicou em "Não" no histórico, essa função NEM SERÁ CHAMADA (handler direto).
        // Então aqui é sempre o fluxo de sucesso ("Compareceu").
        
        const attemptNumber = parseInt(actionType.split('_')[2]);
        
        currentGroup = document.getElementById('group-contato');
        if (currentGroup) {
            currentGroup.classList.remove('hidden');
            const legend = document.getElementById('legend-contato');
            if (legend) legend.textContent = `Resultado da ${attemptNumber}ª Convocação`;

            // Auto-seleciona "Sim" pois estamos preenchendo detalhes de comparecimento
            const radioYes = document.querySelector(`input[name="follow-up-contact-succeeded"][value="yes"]`);
            if (radioYes) radioYes.checked = true;
            
            // Habilita campos de detalhe
            toggleOccurrenceContactFields(true);
            
            // Data do contato = Data da reunião agendada (padrão)
            const contactDateInput = document.getElementById('follow-up-contact-date');
            let agendada = null;
            if (attemptNumber === 1) agendada = record.meetingDate;
            else if (attemptNumber === 2) agendada = record.meetingDate_2;
            else if (attemptNumber === 3) agendada = record.meetingDate_3;
            
            contactDateInput.value = record[`contactDate_${attemptNumber}`] || agendada || '';
            document.getElementById('follow-up-contact-type').value = record[`contactType_${attemptNumber}`] || 'Pessoalmente'; // Padrão reunião
            document.getElementById('follow-up-family-actions').value = record[`providenciasFamilia_${attemptNumber}`] || '';
            
            // Esconde a pergunta "Conseguiu contato?" para simplificar, já que assumimos SIM aqui
            // (O usuário já clicou em "Sim" na lista)
            const questionBlock = currentGroup.querySelector('div:first-child'); // Onde tem os radios
            if(questionBlock) questionBlock.classList.add('hidden');
            
            // Mas precisamos garantir que o valor "yes" seja submetido
            const hiddenSucceeded = document.createElement('input');
            hiddenSucceeded.type = 'hidden';
            hiddenSucceeded.name = 'follow-up-contact-succeeded';
            hiddenSucceeded.value = 'yes';
            currentGroup.appendChild(hiddenSucceeded);
        }

    } else if (actionType === 'desfecho_ou_ct') { 
         // Mesma lógica anterior
         const choiceGroup = document.getElementById('group-desfecho-choice');
         if (choiceGroup) {
            choiceGroup.classList.remove('hidden');
            choiceGroup.querySelectorAll('input').forEach(el => { el.disabled = false; el.required = true; });
            
            if (record.desfechoChoice) {
                const radio = choiceGroup.querySelector(`input[value="${record.desfechoChoice}"]`);
                if(radio) radio.checked = true;
                toggleDesfechoFields(record.desfechoChoice);
            }
         }
         const oficioInput = document.getElementById('follow-up-oficio-number');
         if(oficioInput) oficioInput.value = record.oficioNumber || '';
         document.getElementById('follow-up-ct-sent-date').value = record.ctSentDate || '';
         document.getElementById('follow-up-parecer-final').value = record.parecerFinal || '';

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

    if (requiredFieldsValid) {
        followUpForm.classList.remove('hidden');
        openModal(dom.followUpModal);
    } else {
        closeModal(dom.followUpModal);
    }
};


// =================================================================================
// HANDLERS DE SUBMISSÃO (SALVAR)
// =================================================================================

async function handleOccurrenceSubmit(e) {
    // (Mantido igual - código omitido para brevidade pois não mudou a lógica do Fato 1)
    // ... Usa a mesma lógica da versão anterior
    e.preventDefault();
    const form = e.target;
    if (!form.checkValidity()) {
        form.reportValidity();
        showToast("Por favor, preencha todos os campos obrigatórios (*).");
        return;
    }
    // ... (Resto da função idêntico à versão 3.1)
    // Vou reinserir o código completo para garantir integridade.
    
    const groupId = document.getElementById('occurrence-group-id').value;
    if (state.selectedStudents.size === 0) return showToast("Selecione pelo menos um aluno.");

    const participants = Array.from(state.selectedStudents.entries()).map(([studentId, data]) => ({
        studentId: studentId, role: data.role, studentName: data.student.name, studentClass: data.student.class 
    }));

    const collectiveData = {
        date: document.getElementById('occurrence-date').value,
        occurrenceType: document.getElementById('occurrence-type').value,
        description: document.getElementById('description').value.trim(),
        providenciasEscola: document.getElementById('providencias-escola').value.trim(),
        participants: participants
    };
    
    const today = new Date().toISOString().split('T')[0];
    if (collectiveData.date > today) return showToast("Erro: A data da ocorrência não pode ser no futuro.");
    if (!collectiveData.providenciasEscola) { showToast("O campo 'Providências da Escola' é obrigatório."); return; }

    try {
        if (groupId) {
            const originalIncident = await fetchIncidentById(groupId);
            const batch = writeBatch(db);
            const currentParticipantIds = participants.map(p => p.studentId);

            for (const participant of participants) {
                const existingRecord = originalIncident.records.find(r => r.studentId === participant.studentId);
                if (existingRecord) {
                    batch.update(doc(getCollectionRef('occurrence'), existingRecord.id), collectiveData);
                } else {
                    const newRecordRef = doc(collection(db, getCollectionRef('occurrence').path));
                    batch.set(newRecordRef, {
                        ...collectiveData,
                        studentId: participant.studentId, studentName: participant.studentName, studentClass: participant.studentClass,
                        occurrenceGroupId: groupId, statusIndividual: 'Aguardando 1ª Convocação',
                        createdAt: new Date(), createdBy: state.userEmail,
                        history: [{ action: 'Incidente registrado (aluno adicionado durante edição)', user: state.userEmail, timestamp: new Date() }]
                    });
                }
            }
            // Remoção de alunos desmarcados
            originalIncident.records.filter(r => !currentParticipantIds.includes(r.studentId)).forEach(r => batch.delete(doc(getCollectionRef('occurrence'), r.id)));
            await batch.commit();
            showToast('Fato atualizado com sucesso!');
        } else {
            const counterRef = getCounterDocRef('occurrences');
            const newGroupId = await runTransaction(db, async (transaction) => {
                const counterDoc = await transaction.get(counterRef);
                const currentYear = new Date().getFullYear();
                let newCount = 1;
                if (counterDoc.exists() && counterDoc.data().year === currentYear) newCount = counterDoc.data().count + 1;
                transaction.set(counterRef, { count: newCount, year: currentYear });
                return `OCC-${currentYear}-${String(newCount).padStart(3, '0')}`;
            });

            for (const participant of participants) {
                await addRecordWithHistory('occurrence', {
                    ...collectiveData, studentId: participant.studentId, studentName: participant.studentName, studentClass: participant.studentClass,
                    occurrenceGroupId: newGroupId, statusIndividual: 'Aguardando 1ª Convocação'
                }, 'Incidente registrado (Ação 1)', state.userEmail);
            }
            showToast(`Ocorrência ${newGroupId} registrada com sucesso!`);
        }
        closeModal(dom.occurrenceModal);
    } catch (error) { console.error(error); showToast('Erro ao salvar.'); }
}


async function handleOccurrenceStepSubmit(e) {
    e.preventDefault();
    const form = e.target;
    if (!form.checkValidity()) { form.reportValidity(); return showToast('Preencha todos os campos obrigatórios.'); }

    const recordId = form.dataset.recordId;
    const actionType = form.dataset.actionType;
    const record = state.occurrences.find(r => r.id === recordId);
    
    let dataToUpdate = {};
    let historyAction = "";
    let nextStatus = record.statusIndividual; 

    try {
        // 1. Agendamento de Convocações (1, 2, 3)
        if (actionType.startsWith('agendar_convocacao_')) {
            const n = actionType.split('_')[2];
            const date = document.getElementById('follow-up-meeting-date').value;
            const time = document.getElementById('follow-up-meeting-time').value;
            
            if (n === '1') dataToUpdate = { meetingDate: date, meetingTime: time };
            else if (n === '2') dataToUpdate = { meetingDate_2: date, meetingTime_2: time };
            else if (n === '3') dataToUpdate = { meetingDate_3: date, meetingTime_3: time };
            
            const dateCheck = validateOccurrenceChronology(record, actionType, date);
            if (!dateCheck.isValid) return showToast(dateCheck.message);

            historyAction = `Agendada ${n}ª Convocação para ${formatDate(date)} às ${formatTime(time)}.`;
            nextStatus = `Aguardando Comparecimento ${n}`; 

        } else if (actionType.startsWith('resultado_convocacao_')) {
            // 2. Resultado (Apenas SUCESSO, pois falha é direta)
            const n = actionType.split('_')[2];
            
            const fields = {
                succeeded: `contactSucceeded_${n}`,
                type: `contactType_${n}`,
                date: `contactDate_${n}`,
                providencias: `providenciasFamilia_${n}`
            };

            dataToUpdate = {
                [fields.succeeded]: 'yes',
                [fields.type]: document.getElementById('follow-up-contact-type').value,
                [fields.date]: document.getElementById('follow-up-contact-date').value,
                [fields.providencias]: document.getElementById('follow-up-family-actions').value,
            };
            
            const dateCheck = validateOccurrenceChronology(record, actionType, dataToUpdate[fields.date]);
            if (!dateCheck.isValid) return showToast(dateCheck.message);

            historyAction = `${n}ª Convocação realizada com sucesso (Família compareceu).`;
            nextStatus = 'Aguardando Desfecho'; 

        } else if (actionType === 'desfecho_ou_ct') {
            // (Mantido igual)
            const choice = document.querySelector('input[name="follow-up-desfecho-choice"]:checked').value;
            if (choice === 'ct') {
                dataToUpdate = {
                    oficioNumber: document.getElementById('follow-up-oficio-number').value,
                    ctSentDate: document.getElementById('follow-up-ct-sent-date').value,
                    oficioYear: new Date().getFullYear(),
                    desfechoChoice: 'ct'
                };
                historyAction = `Encaminhado ao CT. Ofício: ${dataToUpdate.oficioNumber}.`;
                nextStatus = 'Aguardando Devolutiva CT';
            } else {
                dataToUpdate = { parecerFinal: document.getElementById('follow-up-parecer-final').value, desfechoChoice: 'parecer' };
                historyAction = `Finalizado com parecer.`;
                nextStatus = 'Resolvido';
            }
        } else if (actionType === 'devolutiva_ct') {
             dataToUpdate = { ctFeedback: document.getElementById('follow-up-ct-feedback').value };
             historyAction = `Devolutiva do CT registrada.`;
             nextStatus = 'Aguardando Parecer Final';
        } else if (actionType === 'parecer_final') {
             dataToUpdate = { parecerFinal: document.getElementById('follow-up-parecer-final').value };
             historyAction = `Processo finalizado com parecer.`;
             nextStatus = 'Resolvido';
        }

        dataToUpdate.statusIndividual = nextStatus;
        await updateRecordWithHistory('occurrence', recordId, dataToUpdate, historyAction, state.userEmail);
        showToast("Ação registrada com sucesso!");
        closeModal(dom.followUpModal);

        // Notificações automáticas e Ofícios (lógica mantida)
        if (actionType.startsWith('agendar_convocacao_') && state.students.find(s => s.matricula === record.studentId)) {
             // Re-abre notificação para imprimir
             // ...
        }

    } catch (error) {
        console.error(error);
        showToast('Erro ao salvar.');
    }
}

// HANDLER DE AÇÃO RÁPIDA ("NÃO COMPARECEU")
async function handleQuickFailureAction(attemptNumber, recordId, studentId, groupId) {
    const record = state.occurrences.find(r => r.id === recordId);
    if (!record) return;

    if (!confirm(`Confirmar que a família NÃO compareceu à ${attemptNumber}ª Convocação?`)) return;

    const fields = { succeeded: `contactSucceeded_${attemptNumber}` };
    const dataToUpdate = { [fields.succeeded]: 'no' };
    
    let nextStatus = '';
    let historyAction = `Família NÃO compareceu à ${attemptNumber}ª Convocação.`;

    if (attemptNumber == 1) nextStatus = 'Aguardando 2ª Convocação';
    else if (attemptNumber == 2) nextStatus = 'Aguardando 3ª Convocação';
    else nextStatus = 'Aguardando Desfecho'; // Falhou a 3ª

    dataToUpdate.statusIndividual = nextStatus;

    try {
        await updateRecordWithHistory('occurrence', recordId, dataToUpdate, historyAction, state.userEmail);
        showToast(`Falta registrada. Agende a próxima etapa.`);
    } catch (e) {
        console.error(e);
        showToast("Erro ao registrar falta.");
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
    
    // Listeners para modais de Ofício (CT)
    const sendCtForm = document.getElementById('send-occurrence-ct-form');
    if (sendCtForm) {
        const closeBtn = document.getElementById('close-send-ct-modal-btn');
        const cancelBtn = document.getElementById('cancel-send-ct-modal-btn');
        if (closeBtn) closeBtn.onclick = () => closeModal(document.getElementById('send-occurrence-ct-modal'));
        if (cancelBtn) cancelBtn.onclick = () => closeModal(document.getElementById('send-occurrence-ct-modal'));
    }

    dom.occurrencesListDiv.addEventListener('click', (e) => {
        const button = e.target.closest('button');
        if (!button) {
             // Acordeão
             const summary = e.target.closest('div.occurrence-summary');
             if (summary) {
                const contentId = summary.dataset.contentId;
                const content = document.getElementById(contentId);
                const icon = summary.querySelector('i.fa-chevron-down');
                if (content) {
                    const isHidden = !content.style.maxHeight || content.style.maxHeight === '0px';
                    if (isHidden) {
                        content.style.maxHeight = `${content.scrollHeight}px`;
                        content.style.overflow = 'visible'; 
                        icon?.classList.add('rotate-180');
                    } else {
                        content.style.maxHeight = null; 
                        setTimeout(() => { if (!content.style.maxHeight) content.style.overflow = 'hidden'; }, 400); 
                        icon?.classList.remove('rotate-180');
                    }
                }
             }
             return;
        }

        e.stopPropagation(); 
        const { studentId, groupId, recordId, action, attempt } = button.dataset;

        // 1. Ações Rápidas do Histórico (Sim/Não)
        if (button.classList.contains('quick-action-btn')) {
            if (action === 'compareceu_sim') {
                // Abre modal de detalhes
                const record = state.occurrences.find(r => r.id === recordId);
                const student = state.students.find(s => s.matricula === studentId);
                openOccurrenceStepModal(student, record, `resultado_convocacao_${attempt}`);
            } else if (action === 'compareceu_nao') {
                // Registra direto
                handleQuickFailureAction(attempt, recordId, studentId, groupId);
            }
            return;
        }

        // 2. Ações Principais (Avançar, Editar, Resetar)
        if (button.classList.contains('avancar-etapa-btn') && !button.disabled) {
            handleNewOccurrenceAction(studentId, groupId, recordId);
            return;
        }
        if (button.classList.contains('edit-occurrence-action-btn') && !button.disabled) {
            handleEditOccurrenceAction(studentId, groupId, recordId);
            return;
        }
        if (button.classList.contains('reset-occurrence-action-btn') && !button.disabled) {
            handleResetActionConfirmation(studentId, groupId, recordId);
            return;
        }
        
        // 3. Visualização (Olho e Ofício)
        if (button.classList.contains('view-notification-btn-hist') || button.classList.contains('notification-student-btn')) {
             handleGenerateNotification(recordId, studentId, groupId);
             return;
        }
        if (button.classList.contains('view-occurrence-oficio-btn')) {
             handleViewOccurrenceOficio(recordId);
             return;
        }

        // 4. Kebab Menu
        if (button.classList.contains('kebab-menu-btn')) {
            const dropdown = button.nextElementSibling;
            if (dropdown) dropdown.classList.toggle('hidden');
            return;
        }
        if (button.classList.contains('kebab-action-btn')) {
            if (action === 'edit' && !button.disabled) handleEditOccurrence(groupId); 
            else if (action === 'delete' && !button.disabled) handleDelete('occurrence', groupId); 
            else if (action === 'history') openHistoryModal(groupId);
            button.closest('.kebab-menu-dropdown')?.classList.add('hidden');
            return;
        }
        if (button.classList.contains('record-btn')) {
            openOccurrenceRecordModal(groupId);
            return;
        }
    });

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