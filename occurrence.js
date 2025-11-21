// =================================================================================
// ARQUIVO: occurrence.js 
// =================================================================================

import { state, dom } from './state.js';
import { showToast, openModal, closeModal, getStatusBadge, formatDate, formatTime } from './utils.js';
import { getCollectionRef, getCounterDocRef, updateRecordWithHistory, addRecordWithHistory, deleteRecord, getIncidentByGroupId as fetchIncidentById } from './firestore.js'; 
// Importa novas lógicas de 3 tentativas e reset
import { determineNextOccurrenceStep, determineCurrentActionFromStatus, occurrenceStepLogic } from './logic.js';
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
// CONFIGURAÇÕES E CONSTANTES
// =================================================================================

// Títulos atualizados para as novas ações (Mapeamento para UI)
export const occurrenceActionTitles = { 
    'convocacao': 'Ação 2: Agendar Convocação',
    'contato_familia_1': 'Ação 3: 1ª Tentativa de Contato',
    'contato_familia_2': 'Ação 3: 2ª Tentativa de Contato',
    'contato_familia_3': 'Ação 3: 3ª Tentativa de Contato',
    'desfecho_ou_ct': 'Ação 4 ou 6: Encaminhar ao CT ou Dar Parecer',
    'devolutiva_ct': 'Ação 5: Registrar Devolutiva do CT',
    'parecer_final': 'Ação 6: Dar Parecer Final'
};

// Ícones para os papéis dos alunos
export const roleIcons = {
    'Vítima': 'fas fa-user-shield text-blue-600',
    'Agente': 'fas fa-gavel text-red-600', 
    'Testemunha': 'fas fa-eye text-green-600',
    'Envolvido': 'fas fa-user text-gray-500'
};
export const defaultRole = 'Envolvido'; 

// Variáveis de estado local para UI (Controle de seleção de alunos e papéis)
let studentPendingRoleSelection = null;
let editingRoleId = null; 

// =================================================================================
// FUNÇÕES DE INTERFACE (UI) - TAGS E SELEÇÃO
// =================================================================================

/**
 * Renderiza as tags dos alunos selecionados no modal de criação/edição.
 * Permite remover alunos ou editar o seu papel (Vítima, Agente, etc.).
 */
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

        // Listener para remover a tag
        tag.querySelector('.remove-tag-btn').addEventListener('click', () => {
            state.selectedStudents.delete(studentId);
            renderTags();
        });

        // Listener para editar o papel (abre dropdown)
        tag.querySelector('.edit-role-btn').addEventListener('click', (e) => {
            e.stopPropagation(); 
            openRoleEditDropdown(e.currentTarget, studentId);
        });

        tagsContainerElement.appendChild(tag);
    });
};

/**
 * Abre o dropdown flutuante para editar o papel de um aluno já adicionado.
 */
const openRoleEditDropdown = (buttonElement, studentId) => {
    const dropdown = document.getElementById('role-edit-dropdown');
    editingRoleId = studentId; 

    // Posicionamento do dropdown
    const rect = buttonElement.getBoundingClientRect();
    dropdown.style.top = `${rect.bottom + window.scrollY}px`;
    dropdown.style.left = `${rect.left + window.scrollX}px`;
    dropdown.classList.remove('hidden');

    // Listener para fechar ao clicar fora
    const closeListener = (e) => {
        if (!dropdown.contains(e.target) && e.target !== buttonElement) {
            dropdown.classList.add('hidden');
            document.removeEventListener('click', closeListener);
            editingRoleId = null;
        }
    };
    setTimeout(() => document.addEventListener('click', closeListener), 0);
};

/**
 * Configura a lógica de input de alunos, sugestões e seleção de papéis.
 */
export const setupStudentTagInput = (inputElement, suggestionsElement, tagsContainerElement) => {
    const roleSelectionPanel = document.getElementById('role-selection-panel');
    const roleSelectionStudentName = document.getElementById('role-selection-student-name');
    const roleSelectButtons = roleSelectionPanel.querySelectorAll('.role-select-btn');
    const roleEditDropdown = document.getElementById('role-edit-dropdown');
    const roleEditOptions = roleEditDropdown.querySelectorAll('.role-edit-option');

    // Limpa estado inicial
    studentPendingRoleSelection = null;
    roleSelectionPanel.classList.add('hidden');
    roleEditDropdown.classList.add('hidden');

    // Lógica de Autocomplete
    inputElement.addEventListener('input', () => {
        const value = inputElement.value.toLowerCase();
        suggestionsElement.innerHTML = '';
        roleSelectionPanel.classList.add('hidden'); 
        studentPendingRoleSelection = null;

        if (!value) {
            suggestionsElement.classList.add('hidden');
            return;
        }
        // Filtra alunos que ainda não foram selecionados
        const filteredStudents = state.students
            .filter(s => !state.selectedStudents.has(s.matricula) && s.name.toLowerCase().includes(value))
            .slice(0, 5);

        if (filteredStudents.length > 0) {
            suggestionsElement.classList.remove('hidden');
            filteredStudents.forEach(student => {
                const item = document.createElement('div');
                item.className = 'suggestion-item p-2 cursor-pointer hover:bg-sky-50'; 
                item.textContent = student.name;
                item.addEventListener('click', () => {
                    // Ao clicar, abre o painel de seleção de papel
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
            suggestionsElement.classList.add('hidden');
        }
    });

    // Lógica dos Botões de Seleção de Papel (Vítima, Agente, etc.)
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

    // Lógica das Opções do Dropdown de Edição de Papel
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

    // Listeners globais para fechar painéis
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
// FUNÇÕES DE DADOS E FILTRAGEM
// =================================================================================

/**
 * Processa os dados brutos das ocorrências, agrupa por incidente e aplica filtros.
 * Retorna um Map onde a chave é o ID do Grupo e o valor é o objeto do incidente.
 */
export const getFilteredOccurrences = () => {
    const groupedByIncident = state.occurrences.reduce((acc, occ) => {
        if (!occ || !occ.studentId) return acc;

        const groupId = occ.occurrenceGroupId || `individual-${occ.id}`;
        if (!acc.has(groupId)) {
            acc.set(groupId, {
                id: groupId,
                records: [],
                participantsInvolved: new Map(),
                overallStatus: 'Aguardando Convocação'
            });
        }
        const incident = acc.get(groupId);
        incident.records.push(occ);

        // Tenta recuperar o papel salvo no registo ou usa o padrão
        const participantData = occ.participants?.find(p => p.studentId === occ.studentId);
        const student = state.students.find(s => s.matricula === occ.studentId);

        if (student && !incident.participantsInvolved.has(student.matricula)) {
             incident.participantsInvolved.set(student.matricula, {
                 student: student,
                 role: participantData?.role || defaultRole 
             });
        }
        return acc;
    }, new Map());

    // Aplica os filtros de UI (Data, Tipo, Status, Busca por Nome)
    const filteredIncidents = new Map();
    for (const [groupId, incident] of groupedByIncident.entries()) {
        const mainRecord = incident.records && incident.records.length > 0 ? incident.records[0] : null;
        if (!mainRecord) continue;

        const { startDate, endDate, status, type } = state.filtersOccurrences;
        const studentSearch = state.filterOccurrences.toLowerCase();

        // Recalcula status geral: Se todos os individuais estiverem 'Resolvido', o geral é 'Finalizada'
        const allResolved = incident.records.every(r => r.statusIndividual === 'Resolvido');
        incident.overallStatus = allResolved ? 'Finalizada' : 'Pendente';

        if (startDate && mainRecord.date < startDate) continue;
        if (endDate && mainRecord.date > endDate) continue;
        if (status !== 'all' && incident.overallStatus !== status) continue;
        if (type !== 'all' && mainRecord.occurrenceType !== type) continue;

        // Filtro de texto (busca por nome de qualquer aluno envolvido)
        if (studentSearch) {
            const hasMatchingStudent = [...incident.participantsInvolved.values()].some(p =>
                p.student.name.toLowerCase().includes(studentSearch)
            );
            if (!hasMatchingStudent) continue;
        }
        filteredIncidents.set(groupId, incident);
    }
    return filteredIncidents;
};


// =================================================================================
// RENDERIZAÇÃO PRINCIPAL (LISTA DE OCORRÊNCIAS)
// =================================================================================

/**
 * Renderiza a lista de ocorrências no ecrã, utilizando o sistema de acordeão.
 * Suporta múltiplas tentativas de contacto e exibição detalhada do histórico.
 */
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

        const studentSearch = state.filterOccurrences.toLowerCase();
        const isFinalizada = incident.overallStatus === 'Finalizada';

        // Renderiza o acordeão para cada aluno envolvido
        const studentAccordionsHTML = [...incident.participantsInvolved.values()]
            .filter(participant => {
                // Filtro de privacidade visual: mostra apenas o aluno pesquisado, se houver pesquisa
                if (studentSearch && !participant.student.name.toLowerCase().includes(studentSearch)) {
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
                const isMatch = studentSearch && student.name.toLowerCase().includes(studentSearch);
                const nameClass = isMatch ? 'font-bold text-yellow-800' : 'font-medium text-gray-700';
                const iconClass = roleIcons[role] || roleIcons[defaultRole];
                const isIndividualResolvido = record?.statusIndividual === 'Resolvido';

                // --- CONSTRUÇÃO DO HISTÓRICO INDIVIDUAL (V4) ---
                let historyHtml = '';
                
                // Ação 2: Convocação
                if (record?.meetingDate) {
                    historyHtml += `<p class="text-xs text-gray-600"><i class="fas fa-check text-green-500 fa-fw mr-1"></i> <strong>Ação 2 (Convocação):</strong> Agendada para ${formatDate(record.meetingDate)} às ${formatTime(record.meetingTime)}.</p>`;
                }
                
                // Ação 3: Tentativas de Contato (Loop pelas 3 tentativas)
                for (let i = 1; i <= 3; i++) {
                    const succeeded = record[`contactSucceeded_${i}`];
                    const date = record[`contactDate_${i}`];
                    
                    if (succeeded != null) {
                        if (succeeded === 'yes') {
                            historyHtml += `<p class="text-xs text-gray-600"><i class="fas fa-check text-green-500 fa-fw mr-1"></i> <strong>Ação 3 (${i}ª Tentativa):</strong> Sucesso (${formatDate(date)}).</p>`;
                        } else {
                            historyHtml += `<p class="text-xs text-gray-600"><i class="fas fa-times text-red-500 fa-fw mr-1"></i> <strong>Ação 3 (${i}ª Tentativa):</strong> Sem sucesso.</p>`;
                        }
                    }
                }

                // Ação 4: Encaminhamento ao CT
                if (record?.oficioNumber) {
                     historyHtml += `<p class="text-xs text-gray-600"><i class="fas fa-check text-green-500 fa-fw mr-1"></i> <strong>Ação 4 (Enc. CT):</strong> Enviado Ofício Nº ${record.oficioNumber}/${record.oficioYear}.</p>`;
                }
                // Ação 5: Devolutiva
                if (record?.ctFeedback) {
                     historyHtml += `<p class="text-xs text-gray-600"><i class="fas fa-check text-green-500 fa-fw mr-1"></i> <strong>Ação 5 (Devolutiva):</strong> Devolutiva recebida.</p>`;
                }
                // Ação 6: Parecer Final
                if (record?.parecerFinal) {
                     historyHtml += `<p class="text-xs text-gray-600"><i class="fas fa-check text-green-500 fa-fw mr-1"></i> <strong>Ação 6 (Parecer Final):</strong> Processo finalizado.</p>`;
                }
                
                if (historyHtml === '') {
                     historyHtml = `<p class="text-xs text-gray-400 italic">Nenhuma ação de acompanhamento registrada.</p>`;
                }
                
                // --- BOTÕES DE AÇÃO INDIVIDUAL ---
                const avancarBtn = `
                    <button type="button"
                            class="avancar-etapa-btn text-sky-600 hover:text-sky-900 text-xs font-semibold py-1 px-2 rounded-md bg-sky-50 hover:bg-sky-100 ${isIndividualResolvido ? 'opacity-50 cursor-not-allowed' : ''}"
                            title="${isIndividualResolvido ? 'Processo individual finalizado' : `Avançar acompanhamento de ${student.name}`}"
                            ${isIndividualResolvido ? 'disabled' : ''}
                            data-group-id="${incident.id}"
                            data-student-id="${student.matricula}"
                            data-record-id="${recordId}">
                        <i class="fas fa-plus"></i> Avançar Etapa
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

                const notificationBtn = (record && record.meetingDate && record.meetingTime) ? `
                    <button type="button"
                            class="notification-student-btn text-sky-600 hover:text-sky-900 text-xs font-semibold py-1 px-2 rounded-md bg-sky-50 hover:bg-sky-100"
                            data-record-id="${recordId}"
                            data-student-id="${student.matricula}"
                            data-group-id="${incident.id}"
                            title="Gerar Notificação para ${student.name}">
                        <i class="fas fa-paper-plane"></i> Notificação
                    </button>
                ` : '';
                
                const editActionBtn = `
                    <button type="button"
                            class="edit-occurrence-action-btn text-yellow-600 hover:text-yellow-900 text-xs font-semibold py-1 px-2 rounded-md bg-yellow-50 hover:bg-yellow-100"
                            data-group-id="${incident.id}"
                            data-student-id="${student.matricula}"
                            data-record-id="${recordId}"
                            title="Editar a última ação salva">
                        <i class="fas fa-pencil-alt"></i> Editar Ação
                    </button>
                `;
                
                const resetActionBtn = `
                     <button type="button"
                            class="reset-occurrence-action-btn text-red-600 hover:text-red-900 text-xs font-semibold py-1 px-2 rounded-md bg-red-50 hover:bg-red-100"
                            data-group-id="${incident.id}"
                            data-student-id="${student.matricula}"
                            data-record-id="${recordId}"
                            title="Limpar a última ação (desfazer)">
                        <i class="fas fa-undo-alt"></i> Limpar
                    </button>
                `;
                
                const contentId = `occ-content-${recordId || student.matricula}`; 
                
                return `
                    <div class="bg-gray-50 rounded-lg border border-gray-200">
                        <!-- Cabeçalho do Acordeão Individual -->
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
                        
                        <!-- Conteúdo Expandível -->
                        <div id="${contentId}" class="process-content" style="max-height: 0px; overflow: hidden;">
                            <div class="p-3 border-t border-gray-200">
                                <h5 class="text-xs font-bold uppercase text-gray-500 mb-2">Histórico Individual</h5>
                                <div class="space-y-1 mb-3">
                                    ${historyHtml}
                                </div>
                                <h5 class="text-xs font-bold uppercase text-gray-500 mb-2">Ações</h5>
                                <div class="flex items-center flex-wrap gap-2">
                                    ${avancarBtn}
                                    ${editActionBtn}
                                    ${resetActionBtn}
                                    ${notificationBtn}
                                    ${viewOficioBtn}
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');

        // HTML do Card Principal (Incidente)
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
                        <!-- Botões de Ação do Incidente -->
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

/**
 * Abre o modal para registrar ou editar os dados COLETIVOS (Ação 1).
 */
export const openOccurrenceModal = (incidentToEdit = null) => {
    dom.occurrenceForm.reset();
    state.selectedStudents.clear(); 

    // Define data máxima como hoje
    const occurrenceDateInput = document.getElementById('occurrence-date');
    const today = new Date().toISOString().split('T')[0];
    occurrenceDateInput.max = today;

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
        occurrenceDateInput.valueAsDate = new Date(); 
    }

    // Configura seleção de alunos
    const studentInput = document.getElementById('student-search-input');
    const suggestionsDiv = document.getElementById('student-suggestions');
    const tagsContainer = document.getElementById('student-tags-container');
    setupStudentTagInput(studentInput, suggestionsDiv, tagsContainer); 

    openModal(dom.occurrenceModal);
};

// =================================================================================
// MODAIS - AÇÕES 2-6 (ACOMPANHAMENTO INDIVIDUAL)
// =================================================================================

/**
 * Alterna a visibilidade e obrigatoriedade dos campos de contato.
 */
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

/**
 * Alterna a visibilidade dos fieldsets de Ação 4 e 6 com base na escolha.
 */
const toggleDesfechoFields = (choice) => {
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


/**
 * Abre o modal de ACOMPANHAMENTO e exibe APENAS a etapa atual.
 * (MODIFICADO V4) Suporte para 3 tentativas de contato.
 */
export const openOccurrenceStepModal = (student, record, actionType) => {
    const followUpForm = document.getElementById('follow-up-form');
    followUpForm.reset();
    followUpForm.dataset.recordId = record.id;
    followUpForm.dataset.studentId = student.matricula;
    followUpForm.dataset.actionType = actionType;

    document.getElementById('follow-up-student-name').value = student.name;

    const statusDisplay = document.getElementById('follow-up-status-display');
    const modalTitle = document.getElementById('follow-up-modal-title');
    
    // Usa o mapa de títulos atualizado para mostrar "1ª Tentativa", etc.
    modalTitle.textContent = occurrenceActionTitles[actionType] || 'Acompanhamento Individual';
    statusDisplay.innerHTML = `<strong>Status:</strong> ${getStatusBadge(record.statusIndividual || 'Aguardando Convocação')}`;

    // Limpa atributos 'min' antigos
    ['follow-up-meeting-date', 'follow-up-contact-date', 'follow-up-ct-sent-date'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.removeAttribute('min');
    });

    // Esconde todos os grupos dinâmicos e desabilita campos
    document.querySelectorAll('.dynamic-occurrence-step').forEach(group => {
        group.classList.add('hidden');
        group.querySelectorAll('input, select, textarea, button').forEach(el => {
            el.disabled = true;
            el.required = false;
        });
        group.querySelectorAll('input[type="radio"]').forEach(radio => radio.checked = false);
    });
    toggleDesfechoFields(null);

    let requiredFieldsValid = true;
    let currentGroup = null;

    // Se o actionType for qualquer uma das 3 tentativas, o grupo é o mesmo ('group-contato')
    const isContactAction = actionType.startsWith('contato_familia_');
    const attemptNumber = isContactAction ? parseInt(actionType.split('_')[2]) : 0;

    if (actionType === 'convocacao') { // Ação 2
        currentGroup = document.getElementById('group-convocacao');
        if (currentGroup) {
            currentGroup.classList.remove('hidden');
            const dateInput = document.getElementById('follow-up-meeting-date');
            const timeInput = document.getElementById('follow-up-meeting-time');
            dateInput.value = record.meetingDate || '';
            timeInput.value = record.meetingTime || '';
            dateInput.disabled = false; dateInput.required = true;
            timeInput.disabled = false; timeInput.required = true;
            if (record.date) dateInput.min = record.date;
        }

    } else if (isContactAction) { // Ação 3 (Tentativas 1, 2, 3)
        
        // Verifica Convocação antes da 1ª Tentativa
        if (attemptNumber === 1 && (!record.meetingDate || !record.meetingTime)) {
            showToast('Erro: Preencha a Ação 2 (Convocação) primeiro.');
            requiredFieldsValid = false;
        } 
        // Verifica se a tentativa anterior falhou antes de abrir a próxima
        else if (attemptNumber > 1) {
            const prevAttempt = attemptNumber - 1;
            // Se a anterior não existe ou foi sucesso, algo está errado no fluxo
            if (record[`contactSucceeded_${prevAttempt}`] !== 'no') {
                showToast(`Erro: A tentativa ${prevAttempt} precisa ter sido registrada como "Não" para abrir a ${attemptNumber}ª.`);
                requiredFieldsValid = false;
            }
        }

        if (requiredFieldsValid) {
            currentGroup = document.getElementById('group-contato');
            if (currentGroup) {
                currentGroup.classList.remove('hidden');
                
                // (NOVO) Atualiza a legenda dinamicamente para indicar a tentativa
                const legend = document.getElementById('legend-contato');
                if (legend) legend.textContent = `Ação 3: ${attemptNumber}ª Tentativa de Contato`;

                const radios = currentGroup.querySelectorAll('input[name="follow-up-contact-succeeded"]');
                radios.forEach(r => { r.disabled = false; r.required = true; });

                // Carrega os dados específicos desta tentativa (_1, _2 ou _3)
                const currentSucceededValue = record[`contactSucceeded_${attemptNumber}`]; 
                const radioChecked = document.querySelector(`input[name="follow-up-contact-succeeded"][value="${currentSucceededValue}"]`);
                if (radioChecked) radioChecked.checked = true;
                
                toggleOccurrenceContactFields(currentSucceededValue === 'yes');
                
                document.getElementById('follow-up-contact-type').value = record[`contactType_${attemptNumber}`] || '';
                
                const contactDateInput = document.getElementById('follow-up-contact-date');
                contactDateInput.value = record[`contactDate_${attemptNumber}`] || '';
                
                // Data mínima: Se for a 1ª, data da convocação. Se for 2ª/3ª, data da tentativa anterior.
                if (attemptNumber === 1 && record.meetingDate) {
                    contactDateInput.min = record.meetingDate;
                } else if (attemptNumber > 1 && record[`contactDate_${attemptNumber-1}`]) {
                    contactDateInput.min = record[`contactDate_${attemptNumber-1}`];
                }

                document.getElementById('follow-up-family-actions').value = record[`providenciasFamilia_${attemptNumber}`] || '';
            }
        }

    } else if (actionType === 'desfecho_ou_ct') { // Ação 4 ou 6 (Decisão)
         // Verifica se pelo menos UMA tentativa foi feita
         const hasAnyAttempt = record.contactSucceeded_1 != null;
         
         if (!hasAnyAttempt) { 
            showToast('Erro: Registre pelo menos uma tentativa de contato primeiro.');
            requiredFieldsValid = false;
        } else {
            const choiceGroup = document.getElementById('group-desfecho-choice');
            if (choiceGroup) {
                choiceGroup.classList.remove('hidden');
                const choiceRadios = choiceGroup.querySelectorAll('input[name="follow-up-desfecho-choice"]');
                choiceRadios.forEach(r => r.disabled = false); 

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
                // Pega a data da última tentativa registrada para usar como min
                let lastContactDate = record.contactDate_3 || record.contactDate_2 || record.contactDate_1 || record.meetingDate;
                if (lastContactDate) dateCtInput.min = lastContactDate;
            }
        }

    } else if (actionType === 'devolutiva_ct') { // Ação 5
        if (!record.oficioNumber || !record.ctSentDate) {
            showToast('Erro: Preencha a Ação 4 (Encaminhamento ao CT) primeiro.');
            requiredFieldsValid = false;
        } else {
            currentGroup = document.getElementById('group-devolutiva-ct');
            if (currentGroup) {
                currentGroup.classList.remove('hidden');
                const feedbackInput = document.getElementById('follow-up-ct-feedback');
                feedbackInput.value = record.ctFeedback || '';
                feedbackInput.disabled = false; feedbackInput.required = true;
            }
        }

    } else if (actionType === 'parecer_final') { // Ação 6
        if (record.oficioNumber && record.ctFeedback == null) {
            showToast('Erro: Preencha a Ação 5 (Devolutiva do CT) primeiro.');
            requiredFieldsValid = false;
        } else if (!record.oficioNumber && record.contactSucceeded_1 == null) { 
             showToast('Erro: Fluxo incompleto.');
             requiredFieldsValid = false;
        } else {
            currentGroup = document.getElementById('group-parecer-final');
            if (currentGroup) {
                currentGroup.classList.remove('hidden');
                const parecerInputFinal = document.getElementById('follow-up-parecer-final');
                parecerInputFinal.value = record.parecerFinal || '';
                parecerInputFinal.disabled = false; parecerInputFinal.required = true;
            }
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

/**
 * Lida com a submissão do formulário de ocorrências (Ação 1: Fato Coletivo).
 */
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
        role: data.role
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
            // EDIÇÃO
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
                    // Novo aluno adicionado na edição
                    const newRecordRef = doc(collection(db, getCollectionRef('occurrence').path));
                    const newRecordData = {
                        ...collectiveData,
                        studentId,
                        occurrenceGroupId: groupId,
                        statusIndividual: 'Aguardando Convocação',
                        meetingDate: null, meetingTime: null, 
                        // Campos V4 inicializados explicitamente
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
            // CRIAÇÃO
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
                    occurrenceGroupId: newGroupId,
                    statusIndividual: 'Aguardando Convocação',
                    meetingDate: null, meetingTime: null,
                    // Inicialização completa para V4
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


/**
 * Lida com a submissão do formulário de ACOMPANHAMENTO (Ações 2-6).
 * (MODIFICADO V4) Lógica de 3 tentativas.
 */
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
        if (actionType === 'convocacao') {
            dataToUpdate = {
                meetingDate: document.getElementById('follow-up-meeting-date').value,
                meetingTime: document.getElementById('follow-up-meeting-time').value,
            };
            if (!dataToUpdate.meetingDate || !dataToUpdate.meetingTime) return showToast('Data e Horário obrigatórios.');
            if (record.date && dataToUpdate.meetingDate < record.date) return showToast('Erro: Convocação anterior ao fato.');
            
            historyAction = `Ação 2 (Convocação) agendada para ${formatDate(dataToUpdate.meetingDate)} às ${formatTime(dataToUpdate.meetingTime)}.`;
            nextStatus = 'Aguardando Contato 1'; 

        } else if (actionType.startsWith('contato_familia_')) {
            // Pega o número da tentativa (1, 2 ou 3)
            const attemptNumber = parseInt(actionType.split('_')[2]);
            const contactSucceededRadio = document.querySelector('input[name="follow-up-contact-succeeded"]:checked');
            const contactSucceeded = contactSucceededRadio ? contactSucceededRadio.value : null;

            if (!contactSucceeded) return showToast('Selecione se conseguiu contato.');

            // Monta os nomes dos campos dinâmicos com o sufixo _n
            const fields = {
                succeeded: `contactSucceeded_${attemptNumber}`,
                type: `contactType_${attemptNumber}`,
                date: `contactDate_${attemptNumber}`,
                providencias: `providenciasFamilia_${attemptNumber}`
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
                
                // Validação de Data: Não pode ser anterior à etapa anterior
                let minDate = record.meetingDate; // Base
                if (attemptNumber > 1) minDate = record[`contactDate_${attemptNumber-1}`];
                
                if (minDate && dataToUpdate[fields.date] < minDate) {
                    return showToast('Erro: Data do contato inválida cronologicamente.');
                }

                historyAction = `Ação 3 (${attemptNumber}ª Tentativa) registrada com sucesso.`;
                nextStatus = 'Aguardando Desfecho'; // Sucesso -> Desfecho

            } else { // contactSucceeded === 'no'
                dataToUpdate = {
                    [fields.succeeded]: 'no',
                    [fields.type]: null, [fields.date]: null, [fields.providencias]: null, // Limpa se mudou de sim para não
                };
                historyAction = `Ação 3 (${attemptNumber}ª Tentativa) sem sucesso.`;
                
                // Lógica de falha: Avança para próxima tentativa ou desfecho
                if (attemptNumber === 1) nextStatus = 'Aguardando Contato 2';
                else if (attemptNumber === 2) nextStatus = 'Aguardando Contato 3';
                else nextStatus = 'Aguardando Desfecho'; // Esgotou em 3
            }

        } else if (actionType === 'desfecho_ou_ct') {
            const desfechoChoiceRadio = document.querySelector('input[name="follow-up-desfecho-choice"]:checked');
            const desfechoChoice = desfechoChoiceRadio ? desfechoChoiceRadio.value : null;

            if (!desfechoChoice) return showToast("Erro: Escolha uma opção.");

            if (desfechoChoice === 'ct') {
                const oficioNumber = document.getElementById('follow-up-oficio-number').value.trim();
                const ctSentDate = document.getElementById('follow-up-ct-sent-date').value;

                if (!oficioNumber || !ctSentDate) return showToast("Erro: Preencha o Ofício e Data.");

                dataToUpdate = {
                    oficioNumber, ctSentDate,
                    oficioYear: new Date(ctSentDate).getFullYear() || new Date().getFullYear(),
                    parecerFinal: null,
                    desfechoChoice: 'ct'
                };
                
                historyAction = `Ação 4 (Encaminhamento ao CT) registrada. Ofício: ${oficioNumber}/${dataToUpdate.oficioYear}.`;
                nextStatus = 'Aguardando Devolutiva CT';

                // Gera ofício automaticamente
                const student = state.students.find(s => s.matricula === form.dataset.studentId);
                if (student) {
                     generateAndShowOccurrenceOficio({ ...record, ...dataToUpdate }, student, dataToUpdate.oficioNumber, dataToUpdate.oficioYear);
                }

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

        // Gera notificação se foi Convocação
        if (actionType === 'convocacao') {
            const studentId = form.dataset.studentId;
            const student = state.students.find(s => s.matricula === studentId);
            if (student) {
                const incident = await fetchIncidentById(record.occurrenceGroupId);
                const updatedRecordForNotification = { ...record, ...dataToUpdate };
                if (incident) {
                    const recordIndex = incident.records.findIndex(r => r.id === recordId);
                    if (recordIndex > -1) incident.records[recordIndex] = updatedRecordForNotification;
                    else incident.records.push(updatedRecordForNotification);
                    
                    openIndividualNotificationModal(incident, student);
                    closeModal(dom.followUpModal);
                }
            }
        } else {
            closeModal(dom.followUpModal);
        }

    } catch (error) {
        console.error("Erro ao salvar etapa:", error);
        showToast('Erro ao salvar a etapa.');
    }
}


// =================================================================================
// AÇÕES ADICIONAIS (EDITAR, EXCLUIR, RESETAR, ENVIAR CT)
// =================================================================================

async function handleEditOccurrence(groupId) {
    const incident = await fetchIncidentById(groupId);
    if (incident) {
        openOccurrenceModal(incident); 
    } else {
        showToast('Incidente não encontrado.');
    }
}

/**
 * (MODIFICADO V4) Suporte a 3 tentativas na edição.
 */
async function handleEditOccurrenceAction(studentId, groupId, recordId) {
    const incident = await fetchIncidentById(groupId);
    if (!incident) return showToast('Erro: Incidente não encontrado.');

    const participantData = incident.participantsInvolved.get(studentId);
    const student = participantData?.student;
    if (!student) return showToast('Erro: Aluno não encontrado.');

    const record = incident.records.find(r => r.id === recordId);
    if (!record) return showToast('Erro: Registro não encontrado.');

    let actionToEdit = determineCurrentActionFromStatus(record.statusIndividual);

    // Refinamento para "Resolvido" ou "Aguardando Desfecho"
    if (record.statusIndividual === 'Resolvido') {
        if (record.desfechoChoice) {
            actionToEdit = 'desfecho_ou_ct';
        } else if (record.parecerFinal) {
             actionToEdit = record.oficioNumber ? 'parecer_final' : 'desfecho_ou_ct';
        }
    } 
    else if (record.statusIndividual === 'Aguardando Desfecho' || actionToEdit === 'contato_familia_x') {
        // Descobre qual foi a última tentativa feita
        if (record.contactSucceeded_3 != null) actionToEdit = 'contato_familia_3';
        else if (record.contactSucceeded_2 != null) actionToEdit = 'contato_familia_2';
        else if (record.contactSucceeded_1 != null) actionToEdit = 'contato_familia_1';
        else actionToEdit = 'convocacao'; // Fallback
    }

    if (actionToEdit === null) {
        showToast('Use "Editar Fato" para alterar a Ação 1.');
        return;
    }
    
    openOccurrenceStepModal(student, record, actionToEdit);
}

/**
 * (MODIFICADO V4) Suporte a 3 tentativas no reset.
 */
async function handleResetActionConfirmation(studentId, groupId, recordId) {
    const incident = await fetchIncidentById(groupId);
    if (!incident) return showToast('Erro: Incidente não encontrado.');
    const record = incident.records.find(r => r.id === recordId);
    if (!record) return showToast('Erro: Registro não encontrado.');
    
    let actionToReset = determineCurrentActionFromStatus(record.statusIndividual);

     if (record.statusIndividual === 'Resolvido') {
        if (record.desfechoChoice) actionToReset = 'desfecho_ou_ct';
        else if (record.parecerFinal) actionToReset = record.oficioNumber ? 'parecer_final' : 'desfecho_ou_ct';
        else actionToReset = 'parecer_final';
    }
    else if (record.statusIndividual === 'Aguardando Desfecho' || actionToReset === 'contato_familia_x') {
        if (record.contactSucceeded_3 != null) actionToReset = 'contato_familia_3';
        else if (record.contactSucceeded_2 != null) actionToReset = 'contato_familia_2';
        else if (record.contactSucceeded_1 != null) actionToReset = 'contato_familia_1';
        else actionToReset = 'convocacao';
    }

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
    document.getElementById('delete-confirm-message').textContent = 'Tem certeza que deseja excluir este incidente e todos os seus registros associados?';
    state.recordToDelete = { type, id };
    openModal(dom.deleteConfirmModal);
}

// --- FLUXO DO BOTÃO AVANÇAR ---
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

// --- FLUXO DO BOTÃO NOTIFICAÇÃO ---
async function handleGenerateNotification(recordId, studentId, groupId) {
    const incident = await fetchIncidentById(groupId); 
     if (!incident) return showToast('Erro: Incidente não encontrado.');

    const participantData = incident.participantsInvolved.get(studentId);
    const student = participantData?.student;
    if (!student) return showToast('Erro: Aluno não encontrado.');

    openIndividualNotificationModal(incident, student);
}

// --- FLUXO DO BOTÃO VER OFÍCIO (LISTA) ---
async function handleViewOccurrenceOficio(recordId) {
    if (!recordId) return;
    let targetRecord = null; let targetIncident = null;

    const recordFromState = state.occurrences.find(r => r.id === recordId);
    if (!recordFromState || !recordFromState.occurrenceGroupId) {
         return showToast('Registro não encontrado.');
    }

    targetIncident = await fetchIncidentById(recordFromState.occurrenceGroupId);
    if (!targetIncident) return showToast('Incidente não encontrado.');

    targetRecord = targetIncident.records.find(r => r.id === recordId);
    if (!targetRecord) return showToast('Registro não encontrado.'); 

    if (!targetRecord.oficioNumber) return showToast('Este registro não possui um ofício associado.');

    const participantData = targetIncident.participantsInvolved.get(targetRecord.studentId);
    const student = participantData?.student;

    if (!student) return showToast('Aluno não encontrado.');
    generateAndShowOccurrenceOficio(targetRecord, student, targetRecord.oficioNumber, targetRecord.oficioYear);
}

// =================================================================================
// FUNÇÕES "LEGADO" RESTAURADAS (FLUXO BOTÃO 'ENVIAR AO CT' DEDICADO)
// =================================================================================

/**
 * Abre o modal dedicado para enviar ao CT (via botão principal, se usado).
 */
async function openSendOccurrenceCtModal(groupId) {
    const incident = await fetchIncidentById(groupId); 
    if (!incident || incident.records.length === 0) return showToast('Incidente não encontrado.');

    const modal = document.getElementById('send-occurrence-ct-modal');
    const form = document.getElementById('send-occurrence-ct-form');
    const studentSelectSection = document.getElementById('send-ct-student-selection-section');
    const studentSelect = document.getElementById('send-ct-student-select');
    const selectedStudentDisplay = document.getElementById('send-ct-selected-student-display');
    const studentNameDisplay = document.getElementById('send-ct-student-name-display');

    form.reset();
    document.getElementById('send-ct-group-id').value = groupId;

    const mainRecord = incident.records[0];
    document.getElementById('send-ct-incident-id-display').textContent = groupId;
    document.getElementById('send-ct-incident-type-display').textContent = mainRecord.occurrenceType || 'N/A';

    if (incident.participantsInvolved.size > 1) {
        studentSelectSection.classList.remove('hidden');
        selectedStudentDisplay.classList.add('hidden');
        studentSelect.innerHTML = '<option value="">Selecione...</option>';
        incident.participantsInvolved.forEach((data, studentId) => {
            const record = incident.records.find(r => r.studentId === studentId);
            if (record) {
                const option = document.createElement('option');
                option.value = record.id; option.textContent = data.student.name;
                option.dataset.studentId = studentId; studentSelect.appendChild(option);
            }
        });
        studentSelect.required = true;
        studentSelect.onchange = () => {
             document.getElementById('send-ct-record-id').value = studentSelect.value;
             const selectedOption = studentSelect.options[studentSelect.selectedIndex];
             document.getElementById('send-ct-student-id').value = selectedOption?.dataset?.studentId || '';
        };
        document.getElementById('send-ct-record-id').value = '';
        document.getElementById('send-ct-student-id').value = '';

    } else if (incident.participantsInvolved.size === 1) {
        studentSelectSection.classList.add('hidden');
        selectedStudentDisplay.classList.remove('hidden');
        const [entry] = incident.participantsInvolved.entries(); 
        const studentId = entry[0];
        const student = entry[1].student;
        const record = incident.records.find(r => r.studentId === studentId);
        studentNameDisplay.textContent = student.name;
        document.getElementById('send-ct-record-id').value = record?.id || '';
        document.getElementById('send-ct-student-id').value = studentId;
        studentSelect.required = false;
    } else {
        showToast('Incidente sem alunos associados.'); return;
    }
    openModal(modal);
}

/**
 * Lida com a submissão do modal "Enviar ao CT" (via botão principal).
 * (Atualizado para setar 'desfechoChoice' = 'ct')
 */
async function handleSendOccurrenceCtSubmit(e) {
    e.preventDefault();
    const form = e.target;
    if (!form.checkValidity()) { form.reportValidity(); return showToast('Por favor, preencha o número do ofício.'); }

    const recordId = document.getElementById('send-ct-record-id').value;
    const studentId = document.getElementById('send-ct-student-id').value;
    const oficioNumber = document.getElementById('send-ct-oficio-number').value.trim();

    if (!recordId || !studentId) { return showToast('Erro: Aluno ou registro inválido. Selecione um aluno.'); }

    const record = state.occurrences.find(r => r.id === recordId);
    if (!record) return showToast("Erro: Registro não encontrado.");
    
    // Validação flexível: Permite se estiver aguardando desfecho OU se for a próxima etapa lógica
    if (record.statusIndividual !== 'Aguardando Desfecho' && record.statusIndividual !== 'Aguardando Contato') {
        // Aviso opcional, mas permite continuar
        console.warn(`Status não ideal para envio ao CT: ${record.statusIndividual}`);
    }

    const oficioYear = new Date().getFullYear();
    const ctSentDate = new Date().toISOString().split('T')[0]; // Data atual
    
    const minDateCt = record.contactDate_3 || record.contactDate_2 || record.contactDate_1 || record.meetingDate;
    if (minDateCt && ctSentDate < minDateCt) {
         return showToast('Erro: A data de envio não pode ser anterior às ações passadas.');
    }

    const dataToUpdate = {
        oficioNumber, oficioYear, ctSentDate,
        statusIndividual: 'Aguardando Devolutiva CT', 
        desfechoChoice: 'ct',
        // Limpa parecer se existir
        parecerFinal: null
    };
    const historyAction = `Ação 4 (Encaminhamento ao CT) registrada via botão dedicado. Ofício: ${oficioNumber}/${oficioYear}.`;

    try {
        await updateRecordWithHistory('occurrence', recordId, dataToUpdate, historyAction, state.userEmail);
        showToast("Registro atualizado com sucesso!");
        closeModal(document.getElementById('send-occurrence-ct-modal'));

        const student = state.students.find(s => s.matricula === studentId);
        const updatedRecordForOficio = { ...record, ...dataToUpdate };

        if (updatedRecordForOficio && student) {
            generateAndShowOccurrenceOficio(updatedRecordForOficio, student, oficioNumber, oficioYear);
        } else {
             showToast("Dados atualizados, mas erro ao recarregar para gerar ofício.");
        }
    } catch (error) {
        console.error("Erro ao enviar ao CT:", error);
        showToast('Erro ao salvar os dados do envio ao CT.');
    }
}


// =================================================================================
// INICIALIZAÇÃO DOS LISTENERS
// =================================================================================

export const initOccurrenceListeners = () => {
    // Botão Adicionar Nova Ocorrência
    document.getElementById('add-occurrence-btn').addEventListener('click', () => openOccurrenceModal());

    // Filtros
    dom.searchOccurrences.addEventListener('input', (e) => { state.filterOccurrences = e.target.value; renderOccurrences(); });
    dom.occurrenceStartDate.addEventListener('change', (e) => { state.filtersOccurrences.startDate = e.target.value; renderOccurrences(); });
    dom.occurrenceEndDate.addEventListener('change', (e) => { state.filtersOccurrences.endDate = e.target.value; renderOccurrences(); });
    document.getElementById('occurrence-filter-type').addEventListener('change', (e) => { state.filtersOccurrences.type = e.target.value; renderOccurrences(); });
    document.getElementById('occurrence-filter-status').addEventListener('change', (e) => { state.filtersOccurrences.status = e.target.value; renderOccurrences(); });

    // Botão Relatório Geral
    dom.generalReportBtn.addEventListener('click', generateAndShowGeneralReport);

    // Submissão de Formulários
    dom.occurrenceForm.addEventListener('submit', handleOccurrenceSubmit);
    dom.followUpForm.addEventListener('submit', handleOccurrenceStepSubmit);
    
    // Formulário do Modal Dedicado de Envio ao CT
    const sendCtForm = document.getElementById('send-occurrence-ct-form');
    if (sendCtForm) sendCtForm.addEventListener('submit', handleSendOccurrenceCtSubmit);

    // Listener Centralizado para a Lista de Ocorrências (Delegação de Eventos)
    dom.occurrencesListDiv.addEventListener('click', (e) => {
        const button = e.target.closest('button');
        if (button) {
            e.stopPropagation(); 

            const studentIdBtn = button.dataset.studentId;
            const groupIdBtn = button.dataset.groupId;
            const recordIdBtn = button.dataset.recordId;

            // Ações DENTRO do Acordeão
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
                if (button.classList.contains('notification-student-btn')) {
                     handleGenerateNotification(recordIdBtn, studentIdBtn, groupIdBtn);
                     return;
                }
                if (button.classList.contains('view-occurrence-oficio-btn')) {
                     handleViewOccurrenceOficio(recordIdBtn);
                     return;
                }
            }
            
            // Ações do Menu Kebab
            if (button.classList.contains('kebab-menu-btn')) {
                const dropdown = button.nextElementSibling;
                if (dropdown) {
                    document.querySelectorAll('.kebab-menu-dropdown').forEach(d => { if (d !== dropdown) d.classList.add('hidden'); });
                    dropdown.classList.toggle('hidden');
                }
                return;
            }
            
            // Ações do Card Principal
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
        
        // Toggle do Acordeão
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

    // Listeners para Rádios Dinâmicos
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

    // Fechar modais ao clicar fora ou botões de fechar
    const closeSendCtBtn = document.getElementById('close-send-ct-modal-btn');
    const cancelSendCtBtn = document.getElementById('cancel-send-ct-modal-btn');
    const sendCtModal = document.getElementById('send-occurrence-ct-modal');
    if (closeSendCtBtn && sendCtModal) closeSendCtBtn.onclick = () => closeModal(sendCtModal);
    if (cancelSendCtBtn && sendCtModal) cancelSendCtBtn.onclick = () => closeModal(sendCtModal);

    // Fechar dropdown de papéis ao clicar fora
    document.addEventListener('click', (e) => {
        const dropdown = document.getElementById('role-edit-dropdown');
        const isEditButton = e.target.closest('.edit-role-btn');
        if (!dropdown.classList.contains('hidden') && !dropdown.contains(e.target) && !isEditButton) {
            dropdown.classList.add('hidden');
            editingRoleId = null;
        }
    });
};