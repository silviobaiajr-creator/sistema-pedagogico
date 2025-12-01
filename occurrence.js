
// =================================================================================
// ARQUIVO: occurrence.js 
// VERSÃO: 5.0 (Design Visual Melhorado + Bordas Coloridas)

import { state, dom } from './state.js';
import { showToast, showAlert, openModal, closeModal, getStatusBadge, formatDate, formatTime, compressImage, openImageModal } from './utils.js';
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
let pendingImagesBase64 = []; 

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

const renderImagePreviews = (containerId) => {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    container.innerHTML = '';
    
    if (pendingImagesBase64.length === 0) {
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');
    container.className = "flex flex-wrap gap-2 mt-2";

    pendingImagesBase64.forEach((imgSrc, index) => {
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
            pendingImagesBase64.splice(index, 1);
            
            const labelEl = document.getElementById(containerId.replace('-preview', '-label'));
            if(labelEl) labelEl.textContent = pendingImagesBase64.length > 0 ? `${pendingImagesBase64.length} Imagens` : 'Selecionar Imagens';
            
            const checkEl = document.getElementById(containerId.replace('-preview', '-check'));
            if(checkEl && pendingImagesBase64.length === 0) checkEl.classList.add('hidden');

            renderImagePreviews(containerId);
        };
        
        wrapper.appendChild(img);
        wrapper.appendChild(removeBtn);
        container.appendChild(wrapper);
    });
};

// =================================================================================
// RENDERIZAÇÃO MELHORADA (LISTA DE OCORRÊNCIAS)
// =================================================================================

const getTypeColorClass = (type) => {
    if (!type) return 'border-gray-200';
    const lowerType = type.toLowerCase();
    if (lowerType.includes('agressão') || lowerType.includes('bullying')) return 'border-red-500';
    if (lowerType.includes('indisciplina') || lowerType.includes('comportamento') || lowerType.includes('telemóvel')) return 'border-yellow-500';
    if (lowerType.includes('dano')) return 'border-orange-500';
    return 'border-sky-500'; // Padrão/Outros
};

const getStepIndicator = (status) => {
    // Mapeamento simples de passos
    const steps = {
        'Aguardando Convocação 1': '1/6',
        'Aguardando Feedback 1': '2/6',
        'Aguardando Convocação 2': '3/6',
        'Aguardando Feedback 2': '4/6',
        'Aguardando Convocação 3': '5/6',
        'Aguardando Desfecho': '5/6',
        'Aguardando Devolutiva CT': '6/6',
        'Aguardando Parecer Final': '6/6',
        'Resolvido': 'Concluído',
        'Finalizada': 'Concluído'
    };
    
    // Tratamento para status genéricos ou iniciais
    if (!status || status === 'Aguardando Convocação') return '1/6';
    
    return steps[status] || '-';
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
        
        // COR DA BORDA LATERAL (Classificação de Risco)
        const borderColorClass = getTypeColorClass(mainRecord.occurrenceType);

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
                const iconClass = roleIcons[role] || roleIcons[defaultRole];
                const isIndividualResolvido = record?.statusIndividual === 'Resolvido';
                
                // STEP INDICATOR
                const step = getStepIndicator(status);

                let historyHtml = '';
                
                // Helper para renderizar bloco de Tentativa
                const renderAttemptBlock = (index, mDate, mTime, succeeded, contactDate, contactPerson, contactPrints, legacyContactPrint) => {
                    if (!mDate) return '';
                    const attemptNum = index; // 1, 2 ou 3
                    const notificationBtn = `
                        <button type="button" class="view-notification-btn-hist text-sky-600 hover:text-sky-900 text-xs font-semibold ml-2 cursor-pointer" 
                                data-record-id="${recordId}" data-student-id="${student.matricula}" data-group-id="${incident.id}" data-attempt="${attemptNum}" title="Ver Notificação">
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
                        // EXIBIÇÃO DE PRINTS (ARRAY OU ÚNICO)
                        let printsHtml = '';
                        
                        // Normaliza para array de visualização
                        let imagesToShow = [];
                        if (contactPrints && Array.isArray(contactPrints) && contactPrints.length > 0) {
                            imagesToShow = contactPrints;
                        } else if (legacyContactPrint) {
                            imagesToShow = [legacyContactPrint];
                        }

                        if (imagesToShow.length > 0) {
                            const btnLabel = imagesToShow.length > 1 ? `[<i class="fas fa-images fa-fw"></i> Ver ${imagesToShow.length} Prints]` : `[<i class="fas fa-image fa-fw"></i> Ver Print]`;
                            printsHtml = `
                                <button type="button" class="view-print-btn text-purple-600 hover:text-purple-800 text-xs font-semibold ml-2 cursor-pointer" onclick="window.viewImage('${imagesToShow[0]}', 'Anexo 1 de ${imagesToShow.length}')">
                                    ${btnLabel}
                                </button>`;
                        }

                        statusContent = `<span class="text-green-600 font-semibold ml-1">- Contato Realizado com <u>${contactPerson || 'Responsável'}</u> em ${formatDate(contactDate)}</span> ${printsHtml}`;
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
                historyHtml += renderAttemptBlock(1, record.meetingDate || record.meetingDate_1, record.meetingTime || record.meetingTime_1, record.contactSucceeded_1, record.contactDate_1, record.contactPerson_1, record.contactPrints_1, record.contactPrint_1);
                historyHtml += renderAttemptBlock(2, record.meetingDate_2, record.meetingTime_2, record.contactSucceeded_2, record.contactDate_2, record.contactPerson_2, record.contactPrints_2, record.contactPrint_2);
                historyHtml += renderAttemptBlock(3, record.meetingDate_3, record.meetingTime_3, record.contactSucceeded_3, record.contactDate_3, record.contactPerson_3, record.contactPrints_3, record.contactPrint_3);

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
                
                // DESIGN HIERÁRQUICO
                return `
                    <div class="bg-gray-50 rounded-lg border border-gray-200 mt-2">
                        <div class="occurrence-summary p-3 cursor-pointer hover:bg-sky-50 flex justify-between items-center"
                             data-content-id="${contentId}">
                            
                            <div class="flex flex-col sm:flex-row sm:items-center gap-2 w-full">
                                <div class="flex items-center gap-2">
                                    <i class="${iconClass} fa-fw w-4 text-center text-gray-500" title="${role}"></i>
                                    <span class="text-lg font-bold text-gray-800 ${isMatch ? 'bg-yellow-200 px-1' : ''}">${student.name}</span>
                                    <span class="text-sm text-gray-500 font-semibold bg-gray-200 px-2 rounded-full">${student.class || 'Turma?'}</span>
                                </div>
                                <div class="flex items-center gap-2 sm:ml-auto mr-4">
                                     <span class="text-xs font-mono bg-white border border-gray-300 px-2 py-0.5 rounded text-gray-600" title="Etapa atual">Passo: ${step}</span>
                                     ${getStatusBadge(status)}
                                </div>
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

        // HEADER DO CARD DE OCORRÊNCIA
        return `
            <div class="border-l-4 ${borderColorClass} rounded-lg bg-white shadow-sm mb-4">
                <div class="p-4 flex flex-col sm:flex-row justify-between items-start gap-3">
                    <div class="flex-grow w-full">
                        <div class="flex justify-between items-start">
                             <div>
                                <h3 class="font-bold text-gray-800 text-base uppercase tracking-wide">${mainRecord.occurrenceType || 'Tipo não informado'}</h3>
                                <p class="text-xs text-gray-500 mt-0.5"><i class="far fa-calendar-alt"></i> ${formatDate(mainRecord.date)} <span class="mx-1">|</span> <span class="font-mono">ID: ${incident.id}</span></p>
                             </div>
                             ${getStatusBadge(incident.overallStatus)}
                        </div>
                        
                        <div class="mt-4">
                            <div class="space-y-0">${studentAccordionsHTML}</div>
                        </div>
                    </div>
                    
                    <div class="flex-shrink-0 flex flex-col items-end gap-2 mt-2 sm:mt-0">
                         <div class="relative kebab-menu-container">
                            <button class="kebab-menu-btn text-gray-400 hover:text-gray-700 p-1" data-group-id="${incident.id}"><i class="fas fa-ellipsis-v fa-lg"></i></button>
                            <div class="kebab-menu-dropdown hidden absolute right-0 mt-1 w-48 bg-white rounded-md shadow-lg border z-10">
                                <button class="kebab-action-btn menu-item w-full text-left" data-action="edit" data-group-id="${incident.id}"><i class="fas fa-pencil-alt mr-2 w-4"></i>Editar Fato</button>
                                <button class="record-btn menu-item w-full text-left" data-group-id="${incident.id}"><i class="fas fa-file-invoice mr-2 w-4"></i>Gerar Ata</button>
                                <button class="kebab-action-btn menu-item w-full text-left" data-action="history" data-group-id="${incident.id}"><i class="fas fa-history mr-2 w-4"></i>Histórico</button>
                                <button class="kebab-action-btn menu-item menu-item-danger w-full text-left" data-action="delete" data-group-id="${incident.id}"><i class="fas fa-trash mr-2 w-4"></i>Excluir</button>
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


export const openOccurrenceStepModal = (student, record, actionType, preFilledData = null) => {
    const followUpForm = document.getElementById('follow-up-form');
    followUpForm.reset();
    
    // Reseta imagens
    pendingImagesBase64 = []; 
    document.getElementById('follow-up-print-label').textContent = 'Selecionar Imagens';
    document.getElementById('follow-up-print-check').classList.add('hidden');
    
    // INJETA O CONTAINER DE PREVIEW SE NÃO EXISTIR
    let previewContainer = document.getElementById('follow-up-print-preview');
    if (!previewContainer) {
        const fileInput = document.getElementById('follow-up-contact-print');
        if (fileInput) {
            // Habilita seleção múltipla
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
            if (el.type !== 'file') el.disabled = true; // Input de arquivo sempre habilitado se visível
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
                if(record.date) dateInput.min = record.date;
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
                if(radio) radio.checked = true;
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

            // CARREGA IMAGENS EXISTENTES SE HOUVER (Para edição)
            // Se estiver editando, não vamos baixar e converter para base64 para preencher o input file (impossível).
            // Apenas mantemos o array vazio e se o usuário não adicionar nada, o backend mantém o antigo.
            // Se adicionar, substitui ou adiciona (depende da lógica de backend, aqui substituiremos se houver novo upload).
            // Visualmente, poderíamos mostrar "X imagens anexadas", mas para simplificar, reseta.
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

            if (!inputDate || !inputTime) return showAlert('Data e Horário obrigatórios.');
            
            const dateCheck = validateOccurrenceChronology(record, actionType, inputDate);
            if (!dateCheck.isValid) return showAlert(dateCheck.message);

            // --- AGENDAMENTO EM LOTE PARA 1ª CONVOCAÇÃO ---
            if (attemptNum == 1) {
                const incident = await fetchIncidentById(record.occurrenceGroupId);
                // Filtra outros alunos no mesmo grupo que ainda estão na etapa 1
                const otherPendingRecords = incident.records.filter(r => 
                    r.id !== recordId && 
                    r.statusIndividual === 'Aguardando Convocação 1'
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

                    // Atualiza os outros
                    otherPendingRecords.forEach(otherRec => {
                        const ref = doc(getCollectionRef('occurrence'), otherRec.id);
                        batch.update(ref, {
                            ...batchUpdateData,
                            history: [...(otherRec.history||[]), { action: batchHistoryAction, user: state.userEmail, timestamp: new Date() }]
                        });
                    });
                    
                    // Adiciona o registro atual ao batch (será executado junto)
                    await batch.commit();
                    showToast(`Agendamento replicado para mais ${otherPendingRecords.length} alunos.`);
                }
            }
            // --- FIM AGENDAMENTO EM LOTE ---

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

            if (!contactSucceeded) return showAlert('Selecione se conseguiu contato.');

            const fields = {
                succeeded: `contactSucceeded_${attemptNum}`,
                type: `contactType_${attemptNum}`,
                date: `contactDate_${attemptNum}`,
                person: `contactPerson_${attemptNum}`, 
                providencias: `providenciasFamilia_${attemptNum}`,
                prints: `contactPrints_${attemptNum}` // SALVA LISTA DE PRINTS
            };

            if (contactSucceeded === 'yes') {
                 dataToUpdate = {
                    [fields.succeeded]: 'yes',
                    [fields.type]: document.getElementById('follow-up-contact-type').value,
                    [fields.date]: document.getElementById('follow-up-contact-date').value,
                    [fields.person]: document.getElementById('follow-up-contact-person').value.trim(),
                    [fields.providencias]: document.getElementById('follow-up-family-actions').value,
                };

                // Se houver novas imagens, salva o array. Se não, não envia o campo (mantém antigo se existir)
                if (pendingImagesBase64.length > 0) {
                    dataToUpdate[fields.prints] = pendingImagesBase64;
                }

                if (!dataToUpdate[fields.type] || !dataToUpdate[fields.date] || !dataToUpdate[fields.providencias] || !dataToUpdate[fields.person]) {
                     return showAlert('Preencha Tipo, Data, Com quem falou e Providências.');
                }
                
                const dateCheck = validateOccurrenceChronology(record, actionType, dataToUpdate[fields.date]);
                if (!dateCheck.isValid) return showAlert(dateCheck.message);

                historyAction = `Ação 3 (Feedback da ${attemptNum}ª Tentativa): Contato realizado com ${dataToUpdate[fields.person]}.`;
                if(pendingImagesBase64.length > 0) historyAction += ` (${pendingImagesBase64.length} anexos).`;
                
                nextStatus = 'Aguardando Desfecho'; 

            } else { 
                dataToUpdate = {
                    [fields.succeeded]: 'no',
                    [fields.type]: null, [fields.date]: null, [fields.person]: null, [fields.providencias]: null, [fields.prints]: null
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

            if (!desfechoChoice) return showAlert("Erro: Escolha uma opção.");

            if (desfechoChoice === 'ct') {
                const oficioNumber = document.getElementById('follow-up-oficio-number').value.trim();
                const ctSentDate = document.getElementById('follow-up-ct-sent-date').value;

                if (!oficioNumber || !ctSentDate) return showAlert("Erro: Preencha o Ofício e Data.");

                const dateCheck = validateOccurrenceChronology(record, 'desfecho_ou_ct', ctSentDate);
                if (!dateCheck.isValid) return showAlert(dateCheck.message);

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
                 if (!parecerFinal) return showAlert("Erro: Preencha o Parecer.");
                 
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
             if (!dataToUpdate.ctFeedback) return showAlert("Erro: Preencha a Devolutiva.");
            historyAction = `Ação 5 (Devolutiva do CT) registrada.`;
            nextStatus = 'Aguardando Parecer Final';

        } else if (actionType === 'parecer_final') { 
            dataToUpdate = {
                parecerFinal: document.getElementById('follow-up-parecer-final').value.trim(),
            };
             if (!dataToUpdate.parecerFinal) return showAlert("Erro: Preencha o Parecer final.");
            historyAction = `Ação 6 (Parecer Final) registrada após devolutiva do CT.`;
            nextStatus = 'Resolvido'; 
        }

    } catch (collectError) {
        console.error("Erro ao coletar dados:", collectError);
        showAlert("Erro ao processar dados.");
        return;
    }

    dataToUpdate.statusIndividual = nextStatus;

    try {
        await updateRecordWithHistory('occurrence', recordId, dataToUpdate, historyAction, state.userEmail);
        showToast("Etapa salva com sucesso!");

        const studentId = form.dataset.studentId;
        const student = state.students.find(s => s.matricula === studentId);

        if (actionType === 'desfecho_ou_ct' && dataToUpdate.desfechoChoice === 'ct') {
             if(student) {
                 generateAndShowOccurrenceOficio({ ...record, ...dataToUpdate }, student, dataToUpdate.oficioNumber, dataToUpdate.oficioYear);
             }
        }

        if (actionType.startsWith('convocacao_') && student) {
            const incident = await fetchIncidentById(record.occurrenceGroupId);
            const updatedRecordForNotification = { ...record, ...dataToUpdate };
            if (incident) {
                const recordIndex = incident.records.findIndex(r => r.id === recordId);
                if (recordIndex > -1) incident.records[recordIndex] = updatedRecordForNotification;
                else incident.records.push(updatedRecordForNotification);
                
                const attemptNum = parseInt(actionType.split('_')[1]) || 1;
                openIndividualNotificationModal(incident, student, attemptNum);
            }
        } 
        
        closeModal(dom.followUpModal);

    } catch (error) {
        console.error("Erro ao salvar etapa:", error);
        showAlert('Erro ao salvar a etapa.');
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

// Handler para o botão "Avançar"
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
    openOccurrenceStepModal(student, record, nextAction);
}

// Handler para botões rápidos de feedback (Sim/Não) na lista
async function handleQuickFeedback(studentId, groupId, recordId, actionType, value) {
    // LÓGICA DE SALVAMENTO IMEDIATO PARA "NÃO"
    if (value === 'no') {
        const incident = await fetchIncidentById(groupId); 
        const record = incident ? incident.records.find(r => r.id === recordId) : null;
        
        if (!record) return showAlert('Erro: Registro não encontrado.');

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
        return; // Não abre modal
    }

    // SE FOR "SIM", SEGUE FLUXO NORMAL (ABRE MODAL)
    const incident = await fetchIncidentById(groupId); 
    if (!incident) return showAlert('Erro: Incidente não encontrado.');

    const participantData = incident.participantsInvolved.get(studentId);
    const student = participantData?.student;
    if (!student) return showAlert('Erro: Aluno não encontrado.');

    const record = incident.records.find(r => r.id === recordId);
    if (!record) return showAlert('Erro: Registro não encontrado.');

    // Abre o modal de feedback pre-preenchido
    openOccurrenceStepModal(student, record, actionType, { succeeded: value });
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
    
    // LISTENER DE UPLOAD DE ARQUIVO (MÚLTIPLOS)
    const fileInput = document.getElementById('follow-up-contact-print');
    if (fileInput) {
        fileInput.addEventListener('change', async (e) => {
            const files = e.target.files;
            if (!files || files.length === 0) return;
            
            document.getElementById('follow-up-print-label').textContent = 'Processando...';
            try {
                // Loop para processar múltiplos arquivos
                for (let i = 0; i < files.length; i++) {
                    const compressedBase64 = await compressImage(files[i]);
                    pendingImagesBase64.push(compressedBase64);
                }
                
                document.getElementById('follow-up-print-label').textContent = `${pendingImagesBase64.length} Imagens`;
                document.getElementById('follow-up-print-check').classList.remove('hidden');
                
                // Renderiza Preview
                renderImagePreviews('follow-up-print-preview');
                
            } catch (err) {
                console.error("Erro ao processar imagem:", err);
                showAlert("Erro ao processar uma ou mais imagens.");
                document.getElementById('follow-up-print-label').textContent = 'Erro';
            }
            // Limpa o input para permitir selecionar o mesmo arquivo novamente se necessário
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
        // Habilita a função global para o botão de ver imagem (injetado via HTML string)
        window.viewImage = (img, title) => openImageModal(img, title);

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
