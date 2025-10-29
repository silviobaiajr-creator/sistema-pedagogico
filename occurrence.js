// =================================================================================
// ARQUIVO: occurrence.js (Fluxo V3 - UI Refinada)
// RESPONSABILIDADE: Gerenciar toda a lógica, UI e eventos da
// funcionalidade "Ocorrências".
//
// ATUALIZAÇÃO (FLUXO V3):
// ... (histórico anterior mantido) ...
//
// ATUALIZAÇÃO (UI Refinada - 25/10/2025):
// ... (histórico anterior mantido) ...
//
// ATUALIZAÇÃO (MELHORIA DE LAYOUT - 26/10/2025):
// ... (histórico anterior mantido) ...
//
// ATUALIZAÇÃO (PLANO DE CORREÇÃO - 29/10/2025):
// 1. (Plano 3a) Adicionada função `getIncidentByGroupId` para otimizar
//    a busca de incidentes individuais.
// 2. (Plano 3a) `renderOccurrences`, `handleEditOccurrence`, `handleViewOccurrenceOficio`,
//    `handleNewOccurrenceAction`, `handleGenerateNotification` e
//    `handleOccurrenceStepSubmit` foram refatorados para usar a nova função otimizada.
// 3. (Plano 1b) `renderOccurrences`: Adicionado 'disabled' e classes de
//    opacidade aos botões "Editar Fato", "Excluir" e ao gatilho do nome do
//    aluno se o status for 'Finalizada' ou 'Resolvido'.
// 4. (Plano 3c) `renderOccurrences`: Botão "Editar Fato" movido do menu
//    kebab para ao lado de "Gerar Ata" para melhor visibilidade.
// 5. (Plano 3b) `openOccurrenceStepModal`: Modificado `case 'desfecho_ou_ct'`
//    para suportar os novos botões de rádio (a serem adicionados no HTML).
// 6. (Plano 3b) Adicionada nova função helper `toggleDesfechoFields` para
//    gerenciar a UI da Ação 4/6.
// 7. (Plano 1a) `handleOccurrenceStepSubmit`: Modificado `case 'contato_familia'`
//    para permitir o avanço do status para 'Aguardando Desfecho' mesmo se
//    o contato "Não" for bem-sucedido.
// 8. (Plano 3b) `handleOccurrenceStepSubmit`: Modificado `case 'desfecho_ou_ct'`
//    para ler os novos botões de rádio e simplificar a validação.
// 9. (Plano 2a) `handleOccurrenceStepSubmit`: Adicionada lógica para abrir
//    automaticamente o modal de notificação após salvar a Ação 2 (Convocação).
// 10. (Plano 3b) `initOccurrenceListeners`: Adicionado listener para os
//     novos botões de rádio da Ação 4/6.
// =================================================================================

import { state, dom } from './state.js';
import { showToast, openModal, closeModal, getStatusBadge, formatDate, formatTime } from './utils.js';
import { getCollectionRef, getCounterDocRef, updateRecordWithHistory, addRecordWithHistory, deleteRecord } from './firestore.js';
// (V3) Importa a nova lógica de determinação de etapa
import { determineNextOccurrenceStep } from './logic.js';
import {
    // openStudentSelectionModal, // Não é mais necessário aqui
    openOccurrenceRecordModal,
    openHistoryModal,
    generateAndShowGeneralReport,
    generateAndShowOccurrenceOficio,
    openIndividualNotificationModal // Importa a função direta
} from './reports.js';
import { writeBatch, doc, collection, query, where, getDocs, runTransaction } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db } from './firebase.js';

// (V3) Mapeia o tipo de ação para o título do modal
const occurrenceActionTitles = {
    'convocacao': 'Ação 2: Agendar Convocação',
    'contato_familia': 'Ação 3: Registrar Contato com Família',
    'desfecho_ou_ct': 'Ação 4 ou 6: Encaminhar ao CT ou Dar Parecer',
    'devolutiva_ct': 'Ação 5: Registrar Devolutiva do CT',
    'parecer_final': 'Ação 6: Dar Parecer Final'
};

// (V3) Mapeia o status atual para o próximo status
const occurrenceNextStatusMap = {
    'Aguardando Convocação': 'Aguardando Contato',       // Após Ação 2
    'Aguardando Contato': 'Aguardando Desfecho',        // Após Ação 3 (Sim OU Não) (MODIFICADO Plano 1a)
    'Aguardando Desfecho': 'Aguardando Desfecho',        // (Plano 1a) Estado base para decisão
    'Aguardando Desfecho (via CT)': 'Aguardando Devolutiva CT', // Após Ação 4
    'Aguardando Desfecho (via Parecer)': 'Resolvido',     // Após Ação 6 (direta)
    'Aguardando Devolutiva CT': 'Aguardando Parecer Final', // Após Ação 5
    'Aguardando Parecer Final': 'Resolvido'              // Após Ação 6 (final)
};

// --- Funções de UI (Movidas de ui.js) ---

/**
 * Gerencia a UI de seleção de múltiplos alunos.
 */
export const setupStudentTagInput = (inputElement, suggestionsElement, tagsContainerElement) => {
    const renderTags = () => {
        tagsContainerElement.innerHTML = '';
        if (state.selectedStudents.size === 0) {
            tagsContainerElement.innerHTML = `<p class="text-sm text-gray-400">Pesquise e selecione um ou mais alunos...</p>`;
            return;
        }
        state.selectedStudents.forEach((student, studentId) => {
            const tag = document.createElement('span');
            tag.className = 'bg-indigo-100 text-indigo-800 text-sm font-medium me-2 px-2.5 py-0.5 rounded-full flex items-center gap-1.5';
            tag.innerHTML = `
                <span>${student.name}</span>
                <span class="text-xs text-indigo-500 font-normal">(${student.class || 'S/ Turma'})</span>
                <button type="button" class="ms-1 text-indigo-600 hover:text-indigo-800">&times;</button>
            `;
            tag.querySelector('button').addEventListener('click', () => {
                state.selectedStudents.delete(studentId);
                renderTags();
            });
            tagsContainerElement.appendChild(tag);
        });
    };

    inputElement.addEventListener('input', () => {
        const value = inputElement.value.toLowerCase();
        suggestionsElement.innerHTML = '';
        if (!value) {
            suggestionsElement.classList.add('hidden');
            return;
        }
        const filteredStudents = state.students
            .filter(s => !state.selectedStudents.has(s.matricula) && s.name.toLowerCase().includes(value))
            .slice(0, 5);

        if (filteredStudents.length > 0) {
            suggestionsElement.classList.remove('hidden');
            filteredStudents.forEach(student => {
                const item = document.createElement('div');
                item.className = 'suggestion-item';
                item.textContent = student.name;
                item.addEventListener('click', () => {
                    state.selectedStudents.set(student.matricula, student);
                    inputElement.value = '';
                    suggestionsElement.classList.add('hidden');
                    renderTags();
                });
                suggestionsElement.appendChild(item);
            });
        } else {
            suggestionsElement.classList.add('hidden');
        }
    });

    document.addEventListener('click', (e) => {
        if (!suggestionsElement.contains(e.target) && e.target !== inputElement) {
            suggestionsElement.classList.add('hidden');
        }
    });
    renderTags();
};

/**
 * Filtra e agrupa ocorrências.
 */
export const getFilteredOccurrences = () => {
    // 1. Agrupa por incidente
    const groupedByIncident = state.occurrences.reduce((acc, occ) => {
        // (CORREÇÃO) Pula registros inválidos
        if (!occ || !occ.studentId) return acc;

        const groupId = occ.occurrenceGroupId || `individual-${occ.id}`;
        if (!acc.has(groupId)) {
            // (V3) Inicializa o incidente
            acc.set(groupId, {
                id: groupId,
                records: [],
                studentsInvolved: new Map(),
                overallStatus: 'Aguardando Convocação' // Status inicial (será recalculado)
            });
        }
        const incident = acc.get(groupId);
        incident.records.push(occ);

        // (V3) Adiciona o aluno ao Map
        const student = state.students.find(s => s.matricula === occ.studentId);
        if (student) {
            incident.studentsInvolved.set(student.matricula, student);
        }
        return acc;
    }, new Map());

    // 2. Filtra os incidentes agrupados
    const filteredIncidents = new Map();
    for (const [groupId, incident] of groupedByIncident.entries()) {
        const mainRecord = incident.records && incident.records.length > 0 ? incident.records[0] : null;
        if (!mainRecord) continue;

        const { startDate, endDate, status, type } = state.filtersOccurrences;
        const studentSearch = state.filterOccurrences.toLowerCase();

        const allResolved = incident.records.every(r => r.statusIndividual === 'Resolvido');
        incident.overallStatus = allResolved ? 'Finalizada' : 'Pendente';

        if (startDate && mainRecord.date < startDate) continue;
        if (endDate && mainRecord.date > endDate) continue;
        if (status !== 'all' && incident.overallStatus !== status) continue;
        if (type !== 'all' && mainRecord.occurrenceType !== type) continue;

        if (studentSearch) {
            const students = incident.studentsInvolved ? [...incident.studentsInvolved.values()] : [];
            const hasMatchingStudent = students.some(s =>
                s.name.toLowerCase().includes(studentSearch)
            );
            if (!hasMatchingStudent) continue;
        }
        filteredIncidents.set(groupId, incident);
    }
    return filteredIncidents;
};

/**
 * (NOVA Otimização - Plano 3a)
 * Constrói um único objeto de incidente a partir do state,
 * sendo mais rápido que getFilteredOccurrences().get().
 */
export const getIncidentByGroupId = (groupId) => {
    const incident = {
        id: groupId,
        records: [],
        studentsInvolved: new Map(),
        overallStatus: 'Pendente' // Status inicial
    };
    let found = false;

    for (const occ of state.occurrences) {
        // Assegura que occ e occ.studentId existam
        if (!occ || !occ.studentId) continue;
        
        const currentGroupId = occ.occurrenceGroupId || `individual-${occ.id}`;
        if (currentGroupId === groupId) {
            found = true;
            incident.records.push(occ);
            const student = state.students.find(s => s.matricula === occ.studentId);
            if (student && !incident.studentsInvolved.has(student.matricula)) {
                incident.studentsInvolved.set(student.matricula, student);
            }
        }
    }

    if (!found) return null; // Incidente não existe

    // Recalcula o status geral
    const allResolved = incident.records.every(r => r.statusIndividual === 'Resolvido');
    incident.overallStatus = allResolved ? 'Finalizada' : 'Pendente';

    return incident;
};


/**
 * Renderiza a lista de ocorrências.
 * (MODIFICADO UI Refinada: Remove botão CT, move e condiciona Notificação)
 * (MODIFICADO LAYOUT 26/10: Usa Grid e empilha info do aluno)
 * (MODIFICADO PLANO 1b): Desabilita botões se finalizado.
 * (MODIFICADO PLANO 3c): Move botão "Editar Fato" para fora do kebab.
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
        
        // (NOVO - Plano 1b) Verifica se o incidente geral está finalizado
        const isFinalizada = incident.overallStatus === 'Finalizada';

        const studentDetailsHTML = (incident.studentsInvolved ? [...incident.studentsInvolved.values()] : [])
            .map(student => {
                if (!student) return '';
                const record = incident.records.find(r => r && r.studentId === student.matricula);
                const recordId = record?.id || '';
                const status = record?.statusIndividual || 'Aguardando Convocação';
                
                // (NOVO - Plano 1b) Verifica se o registro individual está resolvido
                const isResolved = status === 'Resolvido'; 
                
                const isMatch = studentSearch && student.name.toLowerCase().includes(studentSearch);
                const nameClass = isMatch ? 'font-bold text-yellow-800' : 'font-medium text-gray-700';
                let borderClass = isMatch ? 'border-yellow-300 bg-yellow-50' : 'border-gray-200 bg-gray-50';
                let hoverClass = isMatch ? 'hover:bg-yellow-100' : 'hover:bg-indigo-50';
                
                // (MODIFICADO - Plano 1b) Adiciona classes de 'disabled'
                if (isResolved) {
                    hoverClass = 'opacity-50 cursor-not-allowed'; 
                }

                // Botão Ver Ofício (mantido)
                const viewOficioBtn = record?.oficioNumber ? `
                    <button type="button"
                            class="view-occurrence-oficio-btn text-green-600 hover:text-green-900 text-xs font-semibold py-1 px-2 rounded-md bg-green-50 hover:bg-green-100"
                            data-record-id="${recordId}"
                            title="Ver Ofício Nº ${record.oficioNumber}/${record.oficioYear || ''}">
                        <i class="fas fa-file-alt"></i> Ver Ofício
                    </button>
                ` : '';

                // (NOVO UI Refinada) Botão Notificação condicional
                const notificationBtn = (record && record.meetingDate && record.meetingTime) ? `
                    <button type="button"
                            class="notification-student-btn text-indigo-600 hover:text-indigo-900 text-xs font-semibold py-1 px-2 rounded-md bg-indigo-50 hover:bg-indigo-100"
                            data-record-id="${recordId}"
                            data-student-id="${student.matricula}"
                            data-group-id="${incident.id}"
                            title="Gerar Notificação para ${student.name}">
                        <i class="fas fa-paper-plane"></i> Notificação
                    </button>
                ` : '';

                // --- INÍCIO DA MODIFICAÇÃO (Organização Vertical Conforme Solicitado) ---
                return `
                    <div class="py-2 px-3 rounded-lg border ${borderClass} ${hoverClass} transition-colors">
                        
                        <!-- (MODIFICADO - Plano 1b) Adiciona 'disabled' e 'title' se resolvido -->
                        <button type="button"
                                class="student-follow-up-trigger"
                                data-group-id="${incident.id}"
                                data-student-id="${student.matricula}"
                                data-record-id="${recordId}"
                                title="${isResolved ? 'Este processo individual está resolvido' : `Abrir acompanhamento de ${student.name}`}"
                                ${isResolved ? 'disabled' : ''}
                                >
                            <span class="${nameClass}">${student.name}</span>
                        </button>
                        
                        <div class="flex items-center flex-wrap gap-2 mt-1 pt-1 border-t ${borderClass}">
                            ${getStatusBadge(status)}
                            ${notificationBtn}
                            ${viewOficioBtn}
                        </div>
                    </div>`;
                // --- FIM DA MODIFICAÇÃO ---
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
                            <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">${studentDetailsHTML}</div>
                            </div>
                        <p class="text-xs text-gray-400 mt-2">Data: ${formatDate(mainRecord.date)} | ID: ${incident.id}</p>
                    </div>
                    <div class="flex-shrink-0 flex flex-col sm:flex-row items-stretch sm:items-center gap-2 self-stretch sm:self-center">
                        <button class="record-btn text-gray-600 hover:text-gray-900 text-xs font-semibold py-2 px-3 rounded-md bg-gray-50 hover:bg-gray-100 border border-gray-300 text-center" data-group-id="${incident.id}" title="Gerar Ata de Ocorrência">
                            <i class="fas fa-file-invoice mr-1"></i> Gerar Ata
                        </button>
                        
                        <!-- (NOVO - Plano 3c) Botão Editar Fato movido para fora do Kebab -->
                        <button class="kebab-action-btn text-gray-600 hover:text-gray-900 text-xs font-semibold py-2 px-3 rounded-md bg-gray-50 hover:bg-gray-100 border border-gray-300 text-center ${isFinalizada ? 'opacity-50 cursor-not-allowed' : ''}" data-action="edit" data-group-id="${incident.id}" title="${isFinalizada ? 'Processo finalizado' : 'Editar Fato'}" ${isFinalizada ? 'disabled' : ''}>
                            <i class="fas fa-pencil-alt mr-1"></i> Editar Fato
                        </button>

                        <div class="relative kebab-menu-container self-center">
                            <button class="kebab-menu-btn text-gray-500 hover:text-gray-800 p-2 rounded-full hover:bg-gray-100" data-group-id="${incident.id}" title="Mais Opções">
                                <i class="fas fa-ellipsis-v"></i>
                            </button>
                            <div class="kebab-menu-dropdown hidden absolute right-0 mt-1 w-48 bg-white rounded-md shadow-lg border z-10">
                                <!-- (REMOVIDO - Plano 3c) Botão Editar Fato removido daqui -->
                                <button class="kebab-action-btn menu-item w-full text-left" data-action="history" data-group-id="${incident.id}"><i class="fas fa-history mr-2 w-4"></i>Histórico</button>
                                <!-- (MODIFICADO - Plano 1b) Adiciona 'disabled' se finalizado -->
                                <button class="kebab-action-btn menu-item menu-item-danger w-full text-left ${isFinalizada ? 'opacity-50 cursor-not-allowed' : ''}" data-action="delete" data-group-id="${incident.id}" ${isFinalizada ? 'disabled' : ''}><i class="fas fa-trash mr-2 w-4"></i>Excluir</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>`;
    }).join('');
    dom.occurrencesListDiv.innerHTML = html;
};

/**
 * Abre o modal para registrar ou editar os dados COLETIVOS (Ação 1).
 */
export const openOccurrenceModal = (incidentToEdit = null) => {
    dom.occurrenceForm.reset();
    state.selectedStudents.clear();

    if (incidentToEdit) {
        const mainRecord = incidentToEdit.records[0];
        document.getElementById('modal-title').innerText = 'Editar Fato da Ocorrência';
        document.getElementById('occurrence-group-id').value = incidentToEdit.id;
        incidentToEdit.studentsInvolved.forEach((student, studentId) => {
            state.selectedStudents.set(studentId, student);
        });
        document.getElementById('occurrence-type').value = mainRecord.occurrenceType || '';
        document.getElementById('occurrence-date').value = mainRecord.date || '';
        document.getElementById('description').value = mainRecord.description || '';
        document.getElementById('providencias-escola').value = mainRecord.providenciasEscola || '';
    } else {
        document.getElementById('modal-title').innerText = 'Registar Nova Ocorrência';
        document.getElementById('occurrence-group-id').value = '';
        document.getElementById('occurrence-date').valueAsDate = new Date();
    }

    const studentInput = document.getElementById('student-search-input');
    const suggestionsDiv = document.getElementById('student-suggestions');
    const tagsContainer = document.getElementById('student-tags-container');
    setupStudentTagInput(studentInput, suggestionsDiv, tagsContainer);
    openModal(dom.occurrenceModal);
};

/**
 * Alterna a visibilidade e obrigatoriedade dos campos de contato (Ação 3).
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
 * (NOVO - Plano 3b)
 * Alterna a visibilidade dos campos de Desfecho (Ação 4 ou 6)
 * com base na escolha do rádio.
 */
const toggleDesfechoFields = (choice) => {
    const groupCt = document.getElementById('group-encaminhamento-ct');
    const groupParecer = document.getElementById('group-parecer-final');
    if (!groupCt || !groupParecer) return;

    const showCt = choice === 'ct';
    const showParecer = choice === 'parecer';

    // Alterna visibilidade
    groupCt.classList.toggle('hidden', !showCt);
    groupParecer.classList.toggle('hidden', !showParecer);

    // Alterna 'disabled' e 'required' para os inputs do CT
    groupCt.querySelectorAll('input').forEach(input => {
        input.disabled = !showCt;
        // Torna os campos de CT obrigatórios se 'ct' for escolhido
        // (Assume-se que ambos são obrigatórios para o CT)
        input.required = showCt;
    });
    
    // Alterna 'disabled' e 'required' para o input do Parecer
    groupParecer.querySelectorAll('textarea').forEach(input => {
        input.disabled = !showParecer;
        input.required = showParecer;
    });
};


/**
 * Abre o modal de ACOMPANHAMENTO e exibe APENAS a etapa atual.
 * (MODIFICADO - Plano 3b) Ajustado o 'case desfecho_ou_ct'.
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
    modalTitle.textContent = occurrenceActionTitles[actionType] || 'Acompanhamento Individual';
    statusDisplay.innerHTML = `<strong>Status:</strong> ${getStatusBadge(record.statusIndividual || 'Aguardando Convocação')}`;

    document.querySelectorAll('.dynamic-occurrence-step').forEach(group => {
        group.classList.add('hidden');
        group.querySelectorAll('input, select, textarea').forEach(el => {
            el.disabled = true;
            el.required = false;
        });
    });

    let requiredFieldsValid = true;
    let currentGroup = null;

    switch (actionType) {
        case 'convocacao': // Ação 2
            currentGroup = document.getElementById('group-convocacao');
            if (currentGroup) {
                currentGroup.classList.remove('hidden');
                const dateInput = document.getElementById('follow-up-meeting-date');
                const timeInput = document.getElementById('follow-up-meeting-time');
                dateInput.value = record.meetingDate || '';
                timeInput.value = record.meetingTime || '';
                dateInput.disabled = false; dateInput.required = true;
                timeInput.disabled = false; timeInput.required = true;
            }
            break;

        case 'contato_familia': // Ação 3
            if (!record.meetingDate || !record.meetingTime) {
                showToast('Erro: Preencha a Ação 2 (Convocação) primeiro.');
                requiredFieldsValid = false;
            } else {
                currentGroup = document.getElementById('group-contato');
                if (currentGroup) {
                    currentGroup.classList.remove('hidden');
                    const radios = currentGroup.querySelectorAll('input[name="follow-up-contact-succeeded"]');
                    radios.forEach(r => { r.disabled = false; r.required = true; });

                    const radioChecked = document.querySelector(`input[name="follow-up-contact-succeeded"][value="${record.contactSucceeded}"]`);
                    if (radioChecked) {
                        radioChecked.checked = true;
                    } else {
                        radios.forEach(r => r.checked = false);
                    }
                    // (MODIFICADO) Passa o valor do record para o toggle
                    toggleOccurrenceContactFields(record.contactSucceeded === 'yes');
                    document.getElementById('follow-up-contact-type').value = record.contactType || '';
                    document.getElementById('follow-up-contact-date').value = record.contactDate || '';
                    document.getElementById('follow-up-family-actions').value = record.providenciasFamilia || '';
                }
            }
            break;

        case 'desfecho_ou_ct': // Ação 4 ou 6 (Decisão)
             if (record.contactSucceeded == null) {
                showToast('Erro: Preencha a Ação 3 (Contato com Família) primeiro.');
                requiredFieldsValid = false;
            } else {
                // (NOVO - Plano 3b) Mostra o seletor de desfecho
                const desfechoSelectorGroup = document.getElementById('group-desfecho-choice');
                if (desfechoSelectorGroup) {
                    desfechoSelectorGroup.classList.remove('hidden');
                    desfechoSelectorGroup.querySelectorAll('input').forEach(r => { r.disabled = false; r.required = true; });
                    
                    // Reseta a escolha ao abrir
                    document.querySelectorAll('input[name="follow-up-desfecho-choice"]').forEach(r => r.checked = false);
                    
                    // Esconde os grupos de inputs por padrão
                    document.getElementById('group-encaminhamento-ct').classList.add('hidden');
                    document.getElementById('group-parecer-final').classList.add('hidden');
                    
                    // (NOVO - Plano 3b) Pré-seleciona se já houver dados
                    if (record.oficioNumber) {
                         const radioCT = document.querySelector('input[name="follow-up-desfecho-choice"][value="ct"]');
                         if(radioCT) radioCT.checked = true;
                         toggleDesfechoFields('ct'); // Chama a nova função
                    } else if (record.parecerFinal) {
                         const radioParecer = document.querySelector('input[name="follow-up-desfecho-choice"][value="parecer"]');
                         if(radioParecer) radioParecer.checked = true;
                         toggleDesfechoFields('parecer'); // Chama a nova função
                    }
                }

                // A lógica de preenchimento dos campos continua a mesma
                const groupCt = document.getElementById('group-encaminhamento-ct');
                const groupParecer = document.getElementById('group-parecer-final');

                if (groupCt) {
                    // (MODIFICADO - Plano 3b) Não mostra o grupo por padrão
                    // groupCt.classList.remove('hidden'); 
                    const oficioInput = document.getElementById('follow-up-oficio-number');
                    const dateCtInput = document.getElementById('follow-up-ct-sent-date');
                    oficioInput.value = record.oficioNumber || '';
                    dateCtInput.value = record.ctSentDate || '';
                    // (MODIFICADO - Plano 3b) 'disabled' e 'required' serão controlados pelo toggleDesfechoFields
                    oficioInput.disabled = true;
                    dateCtInput.disabled = true;
                }
                if (groupParecer) {
                    // (MODIFICADO - Plano 3b) Não mostra o grupo por padrão
                    // groupParecer.classList.remove('hidden');
                    const parecerInput = document.getElementById('follow-up-parecer-final');
                    parecerInput.value = record.parecerFinal || '';
                    // (MODIFICADO - Plano 3b) 'disabled' será controlado pelo toggleDesfechoFields
                    parecerInput.disabled = true;
                }
            }
            break;

        case 'devolutiva_ct': // Ação 5
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
            break;

        case 'parecer_final': // Ação 6
            if (record.oficioNumber && record.ctFeedback == null) {
                showToast('Erro: Preencha a Ação 5 (Devolutiva do CT) primeiro.');
                requiredFieldsValid = false;
            } else if (record.contactSucceeded == null) {
                 showToast('Erro: Preencha a Ação 3 (Contato com Família) primeiro.');
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
            break;
    }

    if (requiredFieldsValid) {
        followUpForm.classList.remove('hidden');
        openModal(dom.followUpModal);
    } else {
        closeModal(dom.followUpModal);
    }
};


// --- Funções de Handler (Movidas de main.js) ---

/**
 * Lida com a submissão do formulário de ocorrências (Ação 1: Criação do FATO COLETIVO).
 * (MODIFICADO - Plano 3a) Otimizada a busca no modo de edição.
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

    const collectiveData = {
        date: document.getElementById('occurrence-date').value,
        occurrenceType: document.getElementById('occurrence-type').value,
        description: document.getElementById('description').value.trim(),
        providenciasEscola: document.getElementById('providencias-escola').value.trim()
    };

    if (!collectiveData.providenciasEscola) {
        showToast("O campo 'Providências da Escola' é obrigatório.");
        document.getElementById('providencias-escola').focus();
        return;
    }

    try {
        if (groupId) {
            // --- MODO DE EDIÇÃO DO FATO ---
            
            // (MODIFICADO - Plano 3a) Usa o novo helper otimizado
            const originalIncident = getIncidentByGroupId(groupId); 
            if (!originalIncident) throw new Error("Incidente original não encontrado.");

            const historyAction = "Dados gerais do fato (Ação 1) foram atualizados.";
            const batch = writeBatch(db);
            const studentIdsInvolved = [...state.selectedStudents.keys()];

            originalIncident.records.forEach(record => {
                if (studentIdsInvolved.includes(record.studentId)) {
                    const recordRef = doc(getCollectionRef('occurrence'), record.id);
                    batch.update(recordRef, collectiveData);
                }
            });

            for (const studentId of studentIdsInvolved) {
                const isNewStudent = !originalIncident.records.some(r => r.studentId === studentId);
                if (isNewStudent) {
                    const newRecordRef = doc(collection(db, getCollectionRef('occurrence').path));
                    const newRecordData = {
                        ...collectiveData,
                        studentId,
                        occurrenceGroupId: groupId,
                        statusIndividual: 'Aguardando Convocação',
                        meetingDate: null, meetingTime: null, contactSucceeded: null,
                        contactType: null, contactDate: null, providenciasFamilia: null,
                        oficioNumber: null, oficioYear: null, ctSentDate: null,
                        ctFeedback: null, parecerFinal: null,
                        createdAt: new Date(), createdBy: state.userEmail,
                        history: [{ action: 'Incidente registado (aluno adicionado durante edição)', user: state.userEmail, timestamp: new Date() }]
                    };
                    batch.set(newRecordRef, newRecordData);
                }
            }

            const removedStudentIds = originalIncident.records.map(r => r.studentId).filter(id => !studentIdsInvolved.includes(id));
            for (const studentId of removedStudentIds) {
                const recordToDelete = originalIncident.records.find(r => r.studentId === studentId);
                if (recordToDelete) batch.delete(doc(getCollectionRef('occurrence'), recordToDelete.id));
            }

            const recordsToUpdateHistory = await getDocs(query(getCollectionRef('occurrence'), where('occurrenceGroupId', '==', groupId)));
            recordsToUpdateHistory.docs.forEach(docSnapshot => {
                 if (studentIdsInvolved.includes(docSnapshot.data().studentId)) {
                    const newHistoryEntry = { action: historyAction, user: state.userEmail, timestamp: new Date() };
                    const currentHistory = docSnapshot.data().history || [];
                    batch.update(docSnapshot.ref, { history: [...currentHistory, newHistoryEntry] });
                 }
            });

            await batch.commit();
            showToast('Fato da ocorrência atualizado com sucesso!');

        } else {
            // --- MODO DE CRIAÇÃO ---
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

            for (const studentId of state.selectedStudents.keys()) {
                const recordData = {
                    ...collectiveData,
                    studentId,
                    occurrenceGroupId: newGroupId,
                    statusIndividual: 'Aguardando Convocação',
                    meetingDate: null, meetingTime: null, contactSucceeded: null,
                    contactType: null, contactDate: null, providenciasFamilia: null,
                    oficioNumber: null, oficioYear: null, ctSentDate: null,
                    ctFeedback: null, parecerFinal: null
                };
                await addRecordWithHistory('occurrence', recordData, 'Incidente registado (Ação 1)', state.userEmail);
            }
            showToast(`Ocorrência ${newGroupId} registada com sucesso!`);
        }
        closeModal(dom.occurrenceModal);
    } catch (error) {
        console.error("Erro ao salvar ocorrência:", error);
        showToast('Erro ao salvar a ocorrência.');
    }
}

/**
 * Lida com a submissão do formulário de ACOMPANHAMENTO (Ações 2-6).
 * (MODIFICADO - Plano 1a) Ajustado 'case contato_familia'.
 * (MODIFICADO - Plano 3b) Ajustado 'case desfecho_ou_ct'.
 * (MODIFICADO - Plano 2a) Adicionada lógica de notificação automática.
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
        switch (actionType) {
            case 'convocacao': // Ação 2
                dataToUpdate = {
                    meetingDate: document.getElementById('follow-up-meeting-date').value,
                    meetingTime: document.getElementById('follow-up-meeting-time').value,
                };
                historyAction = `Ação 2 (Convocação) agendada para ${formatDate(dataToUpdate.meetingDate)}.`;
                nextStatus = occurrenceNextStatusMap[record.statusIndividual];
                break;

            case 'contato_familia': // Ação 3
                const contactSucceededRadio = document.querySelector('input[name="follow-up-contact-succeeded"]:checked');
                const contactSucceeded = contactSucceededRadio ? contactSucceededRadio.value : null;

                if (contactSucceeded === 'yes') {
                     dataToUpdate = {
                        contactSucceeded: 'yes',
                        contactType: document.getElementById('follow-up-contact-type').value,
                        contactDate: document.getElementById('follow-up-contact-date').value,
                        providenciasFamilia: document.getElementById('follow-up-family-actions').value,
                    };
                    historyAction = `Ação 3 (Contato) registrada com sucesso (Família ciente).`;
                    nextStatus = occurrenceNextStatusMap[record.statusIndividual];
                } else { // (MODIFICADO - Plano 1a)
                    dataToUpdate = {
                        contactSucceeded: 'no',
                        contactType: null, contactDate: null, providenciasFamilia: null,
                    };
                    historyAction = `Ação 3 (Contato) registrada sem sucesso.`;
                    // (MODIFICADO - Plano 1a) Permite avançar o status
                    nextStatus = occurrenceNextStatusMap[record.statusIndividual]; 
                }
                break;

            case 'desfecho_ou_ct': // Ação 4 ou 6 (Decisão)
                // (MODIFICADO - Plano 3b) Ler o rádio de escolha
                const desfechoChoiceRadio = document.querySelector('input[name="follow-up-desfecho-choice"]:checked');
                if (!desfechoChoiceRadio) {
                    showToast("Erro: Selecione uma opção de desfecho (Encaminhar ao CT ou Dar Parecer Final)."); return;
                }
                const desfechoChoice = desfechoChoiceRadio.value;

                if (desfechoChoice === 'ct') { // Ação 4 (CT)
                    const oficioNumber = document.getElementById('follow-up-oficio-number').value.trim();
                    const ctSentDate = document.getElementById('follow-up-ct-sent-date').value;

                    // (MODIFICADO - Plano 3b) Validação agora é mais simples
                    if (!oficioNumber || !ctSentDate) {
                       showToast("Erro: Preencha o Nº do Ofício e a Data de Envio para encaminhar ao CT."); return;
                    }

                    dataToUpdate = {
                        oficioNumber, ctSentDate,
                        oficioYear: new Date(ctSentDate).getFullYear() || new Date().getFullYear(),
                        parecerFinal: null // Garante que o parecer seja nulo
                    };
                    historyAction = `Ação 4 (Encaminhamento ao CT) registrada. Ofício: ${oficioNumber}.`;
                    nextStatus = 'Aguardando Devolutiva CT';

                    // Gerar Ofício aqui se ainda desejado DENTRO da etapa
                    const studentId = form.dataset.studentId;
                    const student = state.students.find(s => s.matricula === studentId);
                    if (student) {
                         generateAndShowOccurrenceOficio({ ...record, ...dataToUpdate }, student, dataToUpdate.oficioNumber, dataToUpdate.oficioYear);
                    }

                } else if (desfechoChoice === 'parecer') { // Ação 6 (Parecer Direto)
                    const parecerFinal = document.getElementById('follow-up-parecer-final').value.trim();
                    
                    if (!parecerFinal) {
                        showToast("Erro: Preencha o Parecer Final para resolver o incidente."); return;
                    }
                    
                     dataToUpdate = {
                        parecerFinal, 
                        oficioNumber: null, ctSentDate: null, oficioYear: null // Garante que CT seja nulo
                    };
                    historyAction = `Ação 6 (Parecer Final) registrada (sem envio ao CT).`;
                    nextStatus = 'Resolvido';
                }
                break;

            case 'devolutiva_ct': // Ação 5
                dataToUpdate = {
                    ctFeedback: document.getElementById('follow-up-ct-feedback').value,
                };
                historyAction = `Ação 5 (Devolutiva do CT) registrada.`;
                nextStatus = occurrenceNextStatusMap[record.statusIndividual];
                break;

            case 'parecer_final': // Ação 6
                dataToUpdate = {
                    parecerFinal: document.getElementById('follow-up-parecer-final').value,
                };
                historyAction = record.oficioNumber
                   ? `Ação 6 (Parecer Final) registrada após devolutiva do CT.`
                   : `Ação 6 (Parecer Final) registrada diretamente após contato.`;
                nextStatus = occurrenceNextStatusMap[record.statusIndividual];
                break;

            default: showToast("Erro: Tipo de ação desconhecido."); return;
        }
    } catch (collectError) {
        console.error("Erro ao coletar dados do formulário:", collectError);
        showToast("Erro ao processar os dados do formulário.");
        return;
    }

    dataToUpdate.statusIndividual = nextStatus;

    try {
        await updateRecordWithHistory('occurrence', recordId, dataToUpdate, historyAction, state.userEmail);
        showToast("Etapa salva com sucesso!");

        // (NOVO - Plano 2a) Gerar notificação automaticamente
        if (actionType === 'convocacao') {
            const studentId = form.dataset.studentId;
            const student = state.students.find(s => s.matricula === studentId);
            if (student) {
                // (Otimização - Plano 3a) Usar o novo helper
                const incident = getIncidentByGroupId(record.occurrenceGroupId);
                
                // Criamos um 'record' simulado com os dados recém-salvos
                const updatedRecord = { ...record, ...dataToUpdate };

                if (incident) {
                    // Atualiza o registro dentro do incidente (apenas em memória)
                    const recordIndex = incident.records.findIndex(r => r.id === updatedRecord.id);
                    if (recordIndex > -1) {
                        incident.records[recordIndex] = updatedRecord;
                    } else {
                        incident.records.push(updatedRecord); // Adiciona se não achar (fallback)
                    }
                    // Chama a notificação
                    openIndividualNotificationModal(incident, student);
                } else {
                    showToast("Dados salvos, mas erro ao recarregar incidente para notificação.");
                }
            }
        }
        
        closeModal(dom.followUpModal); // Fecha o modal de Ação
    } catch (error) {
        console.error("Erro ao salvar etapa:", error);
        showToast('Erro ao salvar a etapa.');
    }
}


/**
 * Lida com a edição de um fato (helper).
 * (MODIFICADO - Plano 3a) Otimizado.
 */
function handleEditOccurrence(groupId) {
    // (MODIFICADO - Plano 3a) Usa o novo helper otimizado
    const incident = getIncidentByGroupId(groupId); 
    if (incident) {
        openOccurrenceModal(incident);
    } else {
        showToast('Incidente não encontrado para edição.');
    }
}

/**
 * Lida com a exclusão de um incidente (helper).
 */
function handleDelete(type, id) {
    document.getElementById('delete-confirm-message').textContent = 'Tem certeza que deseja excluir este incidente e todos os seus registros? Esta ação não pode ser desfeita.';
    state.recordToDelete = { type, id };
    openModal(dom.deleteConfirmModal);
}

// ==============================================================================
// --- Funções para o fluxo "Enviar ao CT" (Botão separado) ---
// ==============================================================================

/**
 * Abre o modal para enviar ao CT (via botão principal, se necessário).
 * (MODIFICADO - Plano 3a) Otimizado.
 */
function openSendOccurrenceCtModal(groupId) {
    // (MODIFICADO - Plano 3a) Usa o novo helper otimizado
    const incident = getIncidentByGroupId(groupId); 
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

    if (incident.studentsInvolved.size > 1) {
        studentSelectSection.classList.remove('hidden');
        selectedStudentDisplay.classList.add('hidden');
        studentSelect.innerHTML = '<option value="">Selecione...</option>';
        incident.studentsInvolved.forEach((student, studentId) => {
            const record = incident.records.find(r => r.studentId === studentId);
            if (record) {
                const option = document.createElement('option');
                option.value = record.id; option.textContent = student.name;
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

    } else if (incident.studentsInvolved.size === 1) {
        studentSelectSection.classList.add('hidden');
        selectedStudentDisplay.classList.remove('hidden');
        const [studentEntry] = incident.studentsInvolved.entries();
        const studentId = studentEntry[0]; const student = studentEntry[1];
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
 */
async function handleSendOccurrenceCtSubmit(e) {
    e.preventDefault();
    const form = e.target;
    if (!form.checkValidity()) { form.reportValidity(); return showToast('Por favor, preencha o número do ofício.'); }

    const groupId = document.getElementById('send-ct-group-id').value;
    const recordId = document.getElementById('send-ct-record-id').value;
    const studentId = document.getElementById('send-ct-student-id').value;
    const oficioNumber = document.getElementById('send-ct-oficio-number').value.trim();

    if (!recordId || !studentId) { return showToast('Erro: Aluno ou registro inválido. Selecione um aluno.'); }

    const record = state.occurrences.find(r => r.id === recordId);
    if (!record) return showToast("Erro: Registro não encontrado.");
    if (record.statusIndividual !== 'Aguardando Desfecho') {
        showToast(`Erro: O aluno deve estar no status 'Aguardando Desfecho'. Status atual: ${record.statusIndividual}`); return;
    }

    const oficioYear = new Date().getFullYear();
    const ctSentDate = new Date().toISOString().split('T')[0];

    const dataToUpdate = {
        oficioNumber, oficioYear, ctSentDate,
        statusIndividual: 'Aguardando Devolutiva CT'
    };
    const historyAction = `Ação 4 (Encaminhamento ao CT) registrada. Ofício: ${oficioNumber}/${oficioYear}.`;

    try {
        await updateRecordWithHistory('occurrence', recordId, dataToUpdate, historyAction, state.userEmail);
        showToast("Registro atualizado com sucesso!");
        closeModal(document.getElementById('send-occurrence-ct-modal'));

        const student = state.students.find(s => s.matricula === studentId);
        if (record && student) {
            // Simula a atualização local para geração imediata do ofício
            const updatedRecordForOficio = { ...record, ...dataToUpdate };
            generateAndShowOccurrenceOficio(updatedRecordForOficio, student, oficioNumber, oficioYear);
        } else {
             showToast("Dados atualizados, mas erro ao recarregar para gerar ofício.");
        }
    } catch (error) {
        console.error("Erro ao enviar ao CT:", error);
        showToast('Erro ao salvar os dados do envio ao CT.');
    }
}


/**
 * Lida com o clique no botão "Ver Ofício".
 * (MODIFICADO - Plano 3a) Otimizado.
 */
function handleViewOccurrenceOficio(recordId) {
    if (!recordId) return;
    
    // (MODIFICADO - Plano 3a) Otimizado para não iterar todos os incidentes
    const targetRecord = state.occurrences.find(r => r.id === recordId);
    if (!targetRecord) return showToast('Registro da ocorrência não encontrado.');

    const groupId = targetRecord.occurrenceGroupId || `individual-${targetRecord.id}`;
    // (MODIFICADO - Plano 3a) Usa o novo helper
    const incident = getIncidentByGroupId(groupId); 
    
    if (!incident) return showToast('Incidente associado não encontrado.');
    if (!targetRecord.oficioNumber) return showToast('Este registro não possui um ofício associado.');
    
    const student = incident.studentsInvolved.get(targetRecord.studentId);
    if (!student) return showToast('Aluno associado ao registro não encontrado.');
    
    generateAndShowOccurrenceOficio(targetRecord, student, targetRecord.oficioNumber, targetRecord.oficioYear);
}


/**
 * Lida com o clique no nome de um aluno para avançar a etapa.
 * (MODIFICADO - Plano 3a) Otimizado.
 */
function handleNewOccurrenceAction(studentId, groupId, recordId) {
    // (MODIFICADO - Plano 3a) Usa o novo helper otimizado
    const incident = getIncidentByGroupId(groupId);
    if (!incident) return showToast('Erro: Incidente não encontrado.');
    
    const student = incident.studentsInvolved.get(studentId);
    if (!student) return showToast('Erro: Aluno não encontrado no incidente.');
    
    const record = incident.records.find(r => r.id === recordId);
    if (!record) return showToast('Erro: Registro individual não encontrado.');

    const nextAction = determineNextOccurrenceStep(record.statusIndividual);
    if (nextAction === null) {
        // (Plano 1b) Mensagem mais clara se já estiver resolvido
        showToast('Este processo individual já foi resolvido.'); 
        return; 
    }
    openOccurrenceStepModal(student, record, nextAction);
}

/**
 * (NOVO UI Refinada) Lida com o clique no botão "Notificação" ao lado do nome.
 * (MODIFICADO - Plano 3a) Otimizado.
 */
function handleGenerateNotification(recordId, studentId, groupId) {
    // (MODIFICADO - Plano 3a) Usa o novo helper otimizado
    const incident = getIncidentByGroupId(groupId);
    if (!incident) return showToast('Erro: Incidente não encontrado.');
    
    const student = incident.studentsInvolved.get(studentId);
    if (!student) return showToast('Erro: Aluno não encontrado.');
    
    // A função openIndividualNotificationModal já busca o record pelo studentId dentro do incident
    openIndividualNotificationModal(incident, student);
}


// --- Função Principal de Inicialização ---

/**
 * Anexa todos os listeners de eventos relacionados a Ocorrências.
 * (MODIFICADO UI Refinada)
 * (MODIFICADO - Plano 3b) Adiciona listener para rádios de desfecho.
 */
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
    if (sendCtForm) sendCtForm.addEventListener('submit', handleSendOccurrenceCtSubmit);

    dom.occurrencesListDiv.addEventListener('click', (e) => {
        const button = e.target.closest('button');
        if (!button) return;

        // (Plano 1b) Se o botão estiver desabilitado, não faz nada
        if (button.disabled) {
             e.stopPropagation();
             return;
        }

        const followUpTrigger = e.target.closest('.student-follow-up-trigger');
        if (followUpTrigger) {
            e.stopPropagation();
            const groupId = followUpTrigger.dataset.groupId;
            const studentId = followUpTrigger.dataset.studentId;
            const recordId = followUpTrigger.dataset.recordId;
            handleNewOccurrenceAction(studentId, groupId, recordId);
            return;
        }

        if (button.classList.contains('kebab-menu-btn')) {
            e.stopPropagation();
            const dropdown = button.nextElementSibling;
            if (dropdown) {
                document.querySelectorAll('.kebab-menu-dropdown').forEach(d => { if (d !== dropdown) d.classList.add('hidden'); });
                dropdown.classList.toggle('hidden');
            }
            return;
        }

        if (button.classList.contains('view-occurrence-oficio-btn')) {
             e.stopPropagation();
             const recordId = button.dataset.recordId;
             handleViewOccurrenceOficio(recordId);
             return;
        }

        // (NOVO UI Refinada) Listener para botão notificação ao lado do nome
        if (button.classList.contains('notification-student-btn')) {
             e.stopPropagation();
             const recordId = button.dataset.recordId;
             const studentId = button.dataset.studentId;
             const groupId = button.dataset.groupId;
             handleGenerateNotification(recordId, studentId, groupId);
             return;
        }

        const groupId = button.dataset.groupId;
        e.stopPropagation();

        // (REMOVIDO UI Refinada) Listener antigo do notification-btn
        // if (button.classList.contains('notification-btn')) { ... }
        if (button.classList.contains('record-btn')) {
            openOccurrenceRecordModal(groupId);
        // (REMOVIDO UI Refinada) Listener do send-occurrence-ct-btn
        // } else if (button.classList.contains('send-occurrence-ct-btn')) { ... }
        } else if (button.classList.contains('kebab-action-btn')) {
            const action = button.dataset.action;
            if (action === 'edit') handleEditOccurrence(groupId);
            else if (action === 'delete') handleDelete('occurrence', groupId);
            else if (action === 'history') openHistoryModal(groupId);

            // Esconde o dropdown se for um botão do kebab
            const dropdown = button.closest('.kebab-menu-dropdown');
            if(dropdown) dropdown.classList.add('hidden');
        }
    });

    // Listener para os rádios de Contato (Ação 3)
    document.querySelectorAll('input[name="follow-up-contact-succeeded"]').forEach(radio =>
        radio.addEventListener('change', (e) => {
            toggleOccurrenceContactFields(e.target.value === 'yes');
        })
    );
    
    // (NOVO - Plano 3b) Listener para os rádios de escolha de desfecho (Ação 4/6)
    document.querySelectorAll('input[name="follow-up-desfecho-choice"]').forEach(radio =>
        radio.addEventListener('change', (e) => {
            toggleDesfechoFields(e.target.value);
        })
    );


    const closeSendCtBtn = document.getElementById('close-send-ct-modal-btn');
    const cancelSendCtBtn = document.getElementById('cancel-send-ct-modal-btn');
    const sendCtModal = document.getElementById('send-occurrence-ct-modal');
    if (closeSendCtBtn && sendCtModal) closeSendCtBtn.onclick = () => closeModal(sendCtModal);
    if (cancelSendCtBtn && sendCtModal) cancelSendCtBtn.onclick = () => closeModal(sendCtModal);
};
