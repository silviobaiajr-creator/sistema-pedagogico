// =================================================================================
// ARQUIVO: occurrence.js (Fluxo V3 - CORREÇÃO Validação)
// RESPONSABILIDADE: Gerenciar toda a lógica, UI e eventos da
// funcionalidade "Ocorrências".
//
// ATUALIZAÇÃO (FLUXO V3):
// 1. Implementa a "Mágica" de salvar o Fato (Ação 1) individualmente
//    para cada aluno, com status inicial 'Aguardando Convocação'.
// 2. Substitui o antigo modal de "Acompanhamento" por um fluxo
//    de etapas dinâmico (Ações 2-6) em `openOccurrenceStepModal`.
// 3. `handleOccurrenceStepSubmit` agora salva os dados da etapa
//    e atualiza o `statusIndividual` do aluno para a próxima etapa.
// 4. `renderOccurrences` exibe cada aluno/registro individualmente.
//
// CORREÇÃO (25/10/2025 - v1):
// 1. `getFilteredOccurrences`: Adiciona checagem (`!occ || !occ.studentId`)
//    para ignorar registros inválidos no `reduce`.
// 2. `getFilteredOccurrences`: Alinha `overallStatus` para 'Finalizada'
//    (ao invés de 'Resolvido') para corresponder ao filtro da UI.
// 3. `renderOccurrences`: Adiciona checagem `(incident.studentsInvolved ? ... : [])`
//    para prevenir o `TypeError: (reading 'map')` se `studentsInvolved`
//    estiver inesperadamente `undefined`.
//
// CORREÇÃO (25/10/2025 - v2 - Validação):
// 1. `openOccurrenceStepModal`: Modificada para DESABILITAR campos de etapas
//    não visíveis e HABILITAR campos da etapa visível.
// 2. `openOccurrenceStepModal`: Adiciona/remove dinamicamente o atributo `required`
//    APENAS nos campos relevantes para a etapa atual, corrigindo erros
//    de validação "not focusable".
// 3. `renderOccurrences`: Adiciona mais checagens internas nos loops `.map()`
//    para maior robustez contra dados potencialmente indefinidos (`record`, `student`).
// =================================================================================

import { state, dom } from './state.js';
import { showToast, openModal, closeModal, getStatusBadge, formatDate, formatTime } from './utils.js';
import { getCollectionRef, getCounterDocRef, updateRecordWithHistory, addRecordWithHistory, deleteRecord } from './firestore.js';
// (V3) Importa a nova lógica de determinação de etapa
import { determineNextOccurrenceStep } from './logic.js';
import {
    openStudentSelectionModal,
    openOccurrenceRecordModal,
    openHistoryModal,
    generateAndShowGeneralReport,
    generateAndShowOccurrenceOficio
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
    'Aguardando Contato': 'Aguardando Desfecho',        // Após Ação 3 (Sim)
    // 'Aguardando Contato' (permanece)                  // Após Ação 3 (Não)
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
 * (MODIFICADO V3: Agrupa registros individuais por aluno/incidente)
 * (CORRIGIDO 25/10): Adiciona checagem `!occ` e `!occ.studentId`
 * (CORRIGIDO 25/10): Alinha `overallStatus` para 'Finalizada'
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
        // (CORREÇÃO v2) Garante que records existe e tem pelo menos um item
        const mainRecord = incident.records && incident.records.length > 0 ? incident.records[0] : null;
        if (!mainRecord) continue;

        const { startDate, endDate, status, type } = state.filtersOccurrences;
        const studentSearch = state.filterOccurrences.toLowerCase();

        // (V3) Calcula o status geral (para o filtro)
        const allResolved = incident.records.every(r => r.statusIndividual === 'Resolvido');

        // (CORREÇÃO) Alinha 'Resolvido' (lógica) com 'Finalizada' (UI)
        incident.overallStatus = allResolved ? 'Finalizada' : 'Pendente';

        if (startDate && mainRecord.date < startDate) continue;
        if (endDate && mainRecord.date > endDate) continue;
        if (status !== 'all' && incident.overallStatus !== status) continue;
        if (type !== 'all' && mainRecord.occurrenceType !== type) continue;

        if (studentSearch) {
             // (CORREÇÃO v2) Garante que studentsInvolved existe antes de usar values()
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
 * Renderiza a lista de ocorrências.
 * (MODIFICADO V3: Renderiza alunos individuais e seus status)
 * (CORRIGIDO 25/10): Adiciona checagem `(incident.studentsInvolved ? ... : [])`
 * (CORRIGIDO 25/10 - v2): Adiciona mais checagens internas (`record`, `student`)
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
        // (CORREÇÃO v2) Garante que mainRecord existe
        const mainRecord = incident.records && incident.records.length > 0 ? incident.records[0] : null;
        if (!mainRecord) return ''; // Pula incidentes sem registros válidos

        const studentSearch = state.filterOccurrences.toLowerCase();

        // (CORREÇÃO) Adiciona checagem `incident.studentsInvolved ? ... : []`
        const studentDetailsHTML = (incident.studentsInvolved ? [...incident.studentsInvolved.values()] : [])
            .map(student => {
                // (CORREÇÃO v2) Garante que student existe
                if (!student) return '';

                const record = incident.records.find(r => r && r.studentId === student.matricula); // Adiciona checagem r
                // (CORREÇÃO v2) Garante que record existe antes de pegar ID
                const recordId = record?.id || '';
                // (V3) Status individual vem do registro do aluno
                const status = record?.statusIndividual || 'Aguardando Convocação';
                const isMatch = studentSearch && student.name.toLowerCase().includes(studentSearch);
                const nameClass = isMatch ? 'font-bold text-yellow-800' : 'font-medium text-gray-700';
                let borderClass = isMatch ? 'border-yellow-300 bg-yellow-50' : 'border-gray-200 bg-gray-50';
                let hoverClass = isMatch ? 'hover:bg-yellow-100' : 'hover:bg-indigo-50';

                const viewOficioBtn = record?.oficioNumber ? `
                    <button type="button"
                            class="view-occurrence-oficio-btn text-green-600 hover:text-green-900 text-xs font-semibold py-1 px-2 rounded-md bg-green-50 hover:bg-green-100 ml-1"
                            data-record-id="${recordId}"
                            title="Ver Ofício Nº ${record.oficioNumber}/${record.oficioYear || ''}">
                        <i class="fas fa-file-alt"></i> Ver Ofício
                    </button>
                ` : '';

                return `
                    <div class="flex items-center gap-1.5 py-1 px-2 rounded-lg border ${borderClass} ${hoverClass} transition-colors">
                        <!-- (V3) Botão agora é o gatilho para a PRÓXIMA ETAPA -->
                        <button type="button"
                                class="student-follow-up-trigger flex items-center gap-1"
                                data-group-id="${incident.id}"
                                data-student-id="${student.matricula}"
                                data-record-id="${recordId}"
                                title="Abrir acompanhamento de ${student.name}">
                            <span class="${nameClass}">${student.name}</span>
                            ${getStatusBadge(status)}
                        </button>
                        ${viewOficioBtn}
                    </div>`;
            }).join('');

        return `
            <div class="border rounded-lg bg-white shadow-sm">
                <div class="p-4 flex flex-col sm:flex-row justify-between items-start gap-3">
                    <div class="flex-grow">
                        <div class="flex items-center gap-3 mb-2">
                            <span class="font-semibold text-gray-800">${mainRecord.occurrenceType || 'N/A'}</span>
                            <!-- (V3) Status geral (Pendente/Finalizada) -->
                            ${getStatusBadge(incident.overallStatus)}
                        </div>
                        <div class="text-sm text-gray-600 mt-2">
                            <strong class="block text-gray-500 text-xs font-bold uppercase mb-1.5">Alunos Envolvidos:</strong>
                            <div class="flex flex-wrap gap-2">${studentDetailsHTML}</div>
                        </div>
                        <p class="text-xs text-gray-400 mt-2">Data: ${formatDate(mainRecord.date)} | ID: ${incident.id}</p>
                    </div>
                    <div class="flex-shrink-0 flex flex-col sm:flex-row items-stretch sm:items-center gap-2 self-stretch sm:self-center">
                        <button class="notification-btn text-indigo-600 hover:text-indigo-900 text-xs font-semibold py-2 px-3 rounded-md bg-indigo-50 hover:bg-indigo-100 text-center" data-group-id="${incident.id}" title="Gerar Notificação">
                            <i class="fas fa-paper-plane mr-1"></i> Notificação
                        </button>
                        <button class="record-btn text-gray-600 hover:text-gray-900 text-xs font-semibold py-2 px-3 rounded-md bg-gray-50 hover:bg-gray-100 border border-gray-300 text-center" data-group-id="${incident.id}" title="Gerar Ata de Ocorrência">
                            <i class="fas fa-file-invoice mr-1"></i> Gerar Ata
                        </button>
                        <button class="send-occurrence-ct-btn text-blue-600 hover:text-blue-900 text-xs font-semibold py-2 px-3 rounded-md bg-blue-50 hover:bg-blue-100 text-center" data-group-id="${incident.id}" title="Enviar ao Conselho Tutelar">
                            <i class="fas fa-gavel mr-1"></i> Enviar ao CT
                        </button>
                        <div class="relative kebab-menu-container self-center">
                            <button class="kebab-menu-btn text-gray-500 hover:text-gray-800 p-2 rounded-full hover:bg-gray-100" data-group-id="${incident.id}" title="Mais Opções">
                                <i class="fas fa-ellipsis-v"></i>
                            </button>
                            <div class="kebab-menu-dropdown hidden absolute right-0 mt-1 w-48 bg-white rounded-md shadow-lg border z-10">
                                <button class="kebab-action-btn menu-item w-full text-left" data-action="edit" data-group-id="${incident.id}"><i class="fas fa-pencil-alt mr-2 w-4"></i>Editar Fato</button>
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

/**
 * Abre o modal para registrar ou editar os dados COLETIVOS (Ação 1).
 * (MODIFICADO V3: Simplificado para conter apenas campos da Ação 1)
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
        // (V3) Preenche o novo campo da Ação 1
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
 * (NOVO V3) Alterna a visibilidade dos campos de contato (Ação 3).
 */
const toggleOccurrenceContactFields = (enable) => {
    const fieldsContainer = document.getElementById('group-contato-fields');
    if (!fieldsContainer) return;

    fieldsContainer.classList.toggle('hidden', !enable);
    const detailFields = fieldsContainer.querySelectorAll('select, input[type="date"], textarea');

    // (CORREÇÃO v2) Gerencia 'disabled' e 'required' dinamicamente
    detailFields.forEach(input => {
        input.disabled = !enable;
        input.required = enable; // Torna obrigatório SOMENTE se "Sim"
    });
};

/**
 * (NOVO V3) Abre o modal de ACOMPANHAMENTO e exibe APENAS a etapa atual.
 * Substitui o antigo `openFollowUpModal`.
 * (CORRIGIDO 25/10 - v2): Gerencia 'disabled' e 'required' dos campos.
 */
export const openOccurrenceStepModal = (student, record, actionType) => {
    const followUpForm = document.getElementById('follow-up-form');
    followUpForm.reset(); // Limpa validações anteriores
    followUpForm.dataset.recordId = record.id;
    followUpForm.dataset.studentId = student.matricula;
    followUpForm.dataset.actionType = actionType; // Salva a ação atual

    // Preenche dados do aluno
    document.getElementById('follow-up-student-name').value = student.name;

    // Define o título do modal e o status
    const statusDisplay = document.getElementById('follow-up-status-display');
    const modalTitle = document.getElementById('follow-up-modal-title');
    modalTitle.textContent = occurrenceActionTitles[actionType] || 'Acompanhamento Individual';
    statusDisplay.innerHTML = `<strong>Status:</strong> ${getStatusBadge(record.statusIndividual || 'Aguardando Convocação')}`;

    // Esconde TODOS os grupos e DESABILITA todos os campos DENTRO deles
    document.querySelectorAll('.dynamic-occurrence-step').forEach(group => {
        group.classList.add('hidden');
        group.querySelectorAll('input, select, textarea').forEach(el => {
            el.disabled = true;
            el.required = false; // Remove 'required' de todos por padrão
        });
    });

    // Lógica para exibir o(s) grupo(s) correto(s), HABILITAR seus campos e definir 'required'
    let requiredFieldsValid = true;
    let currentGroup = null; // Guarda o fieldset da etapa atual

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
                    // Habilita os rádios
                    const radios = currentGroup.querySelectorAll('input[name="follow-up-contact-succeeded"]');
                    radios.forEach(r => { r.disabled = false; r.required = true; });

                    const radioChecked = document.querySelector(`input[name="follow-up-contact-succeeded"][value="${record.contactSucceeded}"]`);
                    if (radioChecked) {
                        radioChecked.checked = true;
                    } else {
                        radios.forEach(r => r.checked = false);
                    }
                    // Campos de detalhe são gerenciados por toggleOccurrenceContactFields
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
                // Mostra AMBOS os grupos e HABILITA seus campos
                const groupCt = document.getElementById('group-encaminhamento-ct');
                const groupParecer = document.getElementById('group-parecer-final');

                if (groupCt) {
                    groupCt.classList.remove('hidden');
                    const oficioInput = document.getElementById('follow-up-oficio-number');
                    const dateCtInput = document.getElementById('follow-up-ct-sent-date');
                    oficioInput.value = record.oficioNumber || '';
                    dateCtInput.value = record.ctSentDate || '';
                    oficioInput.disabled = false; // Não são required aqui, pois são opcionais
                    dateCtInput.disabled = false;
                }
                if (groupParecer) {
                    groupParecer.classList.remove('hidden');
                    const parecerInput = document.getElementById('follow-up-parecer-final');
                    parecerInput.value = record.parecerFinal || '';
                    parecerInput.disabled = false; // Não é required aqui
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

    // Abre o modal somente se a etapa anterior foi validada
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
 * (MODIFICADO V3: Implementa a "Mágica" de salvar registros individuais)
 */
async function handleOccurrenceSubmit(e) {
    e.preventDefault();
    const form = e.target;
     // Adiciona validação do formulário antes de prosseguir
    if (!form.checkValidity()) {
        form.reportValidity(); // Mostra os balões de erro do navegador
        showToast("Por favor, preencha todos os campos obrigatórios (*).");
        return;
    }

    const groupId = document.getElementById('occurrence-group-id').value;
    if (state.selectedStudents.size === 0) return showToast("Selecione pelo menos um aluno.");

    const collectiveData = {
        date: document.getElementById('occurrence-date').value,
        occurrenceType: document.getElementById('occurrence-type').value,
        description: document.getElementById('description').value.trim(),
        providenciasEscola: document.getElementById('providencias-escola').value.trim() // (V3) Novo campo
    };

    // Validação já feita pelo checkValidity, mas mantendo para clareza
    if (!collectiveData.providenciasEscola) {
        showToast("O campo 'Providências da Escola' é obrigatório.");
        document.getElementById('providencias-escola').focus();
        return;
    }

    try {
        if (groupId) {
            // --- MODO DE EDIÇÃO DO FATO ---
            const originalIncident = getFilteredOccurrences().get(groupId);
            if (!originalIncident) throw new Error("Incidente original não encontrado.");

            const historyAction = "Dados gerais do fato (Ação 1) foram atualizados.";
            const batch = writeBatch(db);
            const studentIdsInvolved = [...state.selectedStudents.keys()];

            // (V3) Atualiza registros existentes
            originalIncident.records.forEach(record => {
                if (studentIdsInvolved.includes(record.studentId)) {
                    const recordRef = doc(getCollectionRef('occurrence'), record.id);
                    // (V3) Atualiza apenas os dados do Fato (Ação 1)
                    batch.update(recordRef, collectiveData);
                }
            });

            // (V3) Adiciona novos alunos
            for (const studentId of studentIdsInvolved) {
                const isNewStudent = !originalIncident.records.some(r => r.studentId === studentId);
                if (isNewStudent) {
                    const newRecordRef = doc(collection(db, getCollectionRef('occurrence').path));
                    const newRecordData = {
                        ...collectiveData, // Contém os dados do FATO
                        studentId,
                        occurrenceGroupId: groupId,
                        statusIndividual: 'Aguardando Convocação',
                        // (V3) Inicializa todos os campos das etapas futuras
                        meetingDate: null,
                        meetingTime: null,
                        contactSucceeded: null,
                        contactType: null,
                        contactDate: null,
                        providenciasFamilia: null,
                        oficioNumber: null,
                        oficioYear: null,
                        ctSentDate: null,
                        ctFeedback: null,
                        parecerFinal: null,
                        // (V3) Adiciona histórico
                        createdAt: new Date(),
                        createdBy: state.userEmail,
                        history: [{ action: 'Incidente registado (aluno adicionado durante edição)', user: state.userEmail, timestamp: new Date() }]
                    };
                    batch.set(newRecordRef, newRecordData);
                }
            }

            // (V3) Remove alunos desmarcados
            const removedStudentIds = originalIncident.records.map(r => r.studentId).filter(id => !studentIdsInvolved.includes(id));
            for (const studentId of removedStudentIds) {
                const recordToDelete = originalIncident.records.find(r => r.studentId === studentId);
                if (recordToDelete) batch.delete(doc(getCollectionRef('occurrence'), recordToDelete.id));
            }

            // (V3) Adiciona histórico em todos os registros
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

            // (V3) Salva o fato individualmente para CADA aluno
            for (const studentId of state.selectedStudents.keys()) {
                const recordData = {
                    ...collectiveData, // Contém date, occurrenceType, description, providenciasEscola
                    studentId,
                    occurrenceGroupId: newGroupId,
                    statusIndividual: 'Aguardando Convocação',
                    // (V3) Inicializa todos os campos das etapas futuras
                    meetingDate: null,
                    meetingTime: null,
                    contactSucceeded: null,
                    contactType: null,
                    contactDate: null,
                    providenciasFamilia: null,
                    oficioNumber: null,
                    oficioYear: null,
                    ctSentDate: null,
                    ctFeedback: null,
                    parecerFinal: null
                };
                // (V3) addRecordWithHistory já cria o histórico inicial
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
 * (NOVO V3) Lida com a submissão do formulário de ACOMPANHAMENTO (Ações 2-6).
 * Substitui o antigo `handleFollowUpSubmit`.
 * (CORRIGIDO 25/10 - v2): Usa checkValidity() e reportValidity().
 */
async function handleOccurrenceStepSubmit(e) {
    e.preventDefault();
    const form = e.target;
    // (CORREÇÃO v2) Usa a validação nativa do HTML5
    if (!form.checkValidity()) {
        form.reportValidity(); // Mostra os balões de erro
        return showToast('Por favor, preencha todos os campos obrigatórios (*).');
    }

    const recordId = form.dataset.recordId;
    const actionType = form.dataset.actionType;
    if (!recordId || !actionType) return showToast("Erro: ID do registro ou tipo de ação não encontrado.");

    const record = state.occurrences.find(r => r.id === recordId);
    if (!record) return showToast("Erro: Registro original não encontrado.");

    let dataToUpdate = {};
    let historyAction = "";
    let nextStatus = record.statusIndividual; // Começa com o status atual

    try { // Adiciona try/catch para lidar com erros de coleta de dados
        switch (actionType) {
            case 'convocacao': // Ação 2
                dataToUpdate = {
                    meetingDate: document.getElementById('follow-up-meeting-date').value,
                    meetingTime: document.getElementById('follow-up-meeting-time').value,
                };
                historyAction = `Ação 2 (Convocação) agendada para ${formatDate(dataToUpdate.meetingDate)}.`;
                nextStatus = occurrenceNextStatusMap[record.statusIndividual]; // -> Aguardando Contato
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
                    nextStatus = occurrenceNextStatusMap[record.statusIndividual]; // -> Aguardando Desfecho
                } else {
                    dataToUpdate = {
                        contactSucceeded: 'no',
                        // Limpa campos caso tenham sido preenchidos e depois marcados como "Não"
                        contactType: null,
                        contactDate: null,
                        providenciasFamilia: null,
                    };
                    historyAction = `Ação 3 (Contato) registrada sem sucesso.`;
                    // (V3) O status NÃO avança
                    nextStatus = 'Aguardando Contato';
                }
                break;

            case 'desfecho_ou_ct': // Ação 4 ou 6 (Decisão)
                const oficioNumber = document.getElementById('follow-up-oficio-number').value.trim();
                const ctSentDate = document.getElementById('follow-up-ct-sent-date').value;
                const parecerFinal = document.getElementById('follow-up-parecer-final').value.trim();

                // Validação: OU CT OU Parecer, não ambos. Mas um deles precisa ser preenchido se a ação for esta.
                if ((oficioNumber || ctSentDate) && parecerFinal) {
                    showToast("Erro: Escolha apenas UMA opção - Encaminhar ao CT OU dar o Parecer Final.");
                    return;
                }
                 if (!oficioNumber && !ctSentDate && !parecerFinal) {
                    showToast("Erro: Preencha os dados para Encaminhamento ao CT ou o Parecer Final.");
                    return;
                }

                if (oficioNumber && ctSentDate) { // Usuário escolheu Ação 4 (CT)
                    dataToUpdate = {
                        oficioNumber,
                        ctSentDate,
                        oficioYear: new Date(ctSentDate).getFullYear() || new Date().getFullYear(),
                        parecerFinal: null // Garante que o parecer (Ação 6) seja limpo
                    };
                    historyAction = `Ação 4 (Encaminhamento ao CT) registrada. Ofício: ${oficioNumber}.`;
                    nextStatus = 'Aguardando Devolutiva CT'; // (V3) Mapeamento customizado

                    // (V3) Gerar Ofício automaticamente (mantido, mas não é mais o fluxo principal de envio)
                    // Considerar remover se o botão "Enviar ao CT" for a única forma
                    /*
                    const studentId = form.dataset.studentId;
                    const student = state.students.find(s => s.matricula === studentId);
                    if (student) {
                        generateAndShowOccurrenceOficio({ ...record, ...dataToUpdate }, student, dataToUpdate.oficioNumber, dataToUpdate.oficioYear);
                    }
                    */

                } else { // Usuário escolheu Ação 6 (Parecer Direto)
                     dataToUpdate = {
                        parecerFinal,
                        oficioNumber: null, // Garante que dados do CT sejam limpos
                        ctSentDate: null,
                        oficioYear: null
                    };
                    historyAction = `Ação 6 (Parecer Final) registrada (sem envio ao CT).`;
                    nextStatus = 'Resolvido'; // (V3) Mapeamento customizado
                }
                break;

            case 'devolutiva_ct': // Ação 5
                dataToUpdate = {
                    ctFeedback: document.getElementById('follow-up-ct-feedback').value,
                };
                historyAction = `Ação 5 (Devolutiva do CT) registrada.`;
                nextStatus = occurrenceNextStatusMap[record.statusIndividual]; // -> Aguardando Parecer Final
                break;

            case 'parecer_final': // Ação 6
                dataToUpdate = {
                    parecerFinal: document.getElementById('follow-up-parecer-final').value,
                };
                 // Verifica se veio do CT para ajustar a mensagem do histórico
                if (record.oficioNumber) {
                     historyAction = `Ação 6 (Parecer Final) registrada após devolutiva do CT.`;
                } else {
                     historyAction = `Ação 6 (Parecer Final) registrada diretamente após contato.`;
                }
                nextStatus = occurrenceNextStatusMap[record.statusIndividual]; // -> Resolvido
                break;

            default:
                showToast("Erro: Tipo de ação desconhecido.");
                return;
        }
    } catch (collectError) {
        console.error("Erro ao coletar dados do formulário:", collectError);
        showToast("Erro ao processar os dados do formulário.");
        return;
    }

    // (V3) Adiciona o novo status aos dados a serem salvos
    dataToUpdate.statusIndividual = nextStatus;

    try {
        await updateRecordWithHistory('occurrence', recordId, dataToUpdate, historyAction, state.userEmail);
        showToast("Etapa salva com sucesso!");
        closeModal(dom.followUpModal);
    } catch (error) {
        console.error("Erro ao salvar etapa:", error);
        showToast('Erro ao salvar a etapa.');
    }
}


/**
 * Lida com a edição de um fato (helper).
 */
function handleEditOccurrence(groupId) {
    const incident = getFilteredOccurrences().get(groupId);
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
// --- (V3) Funções para o novo fluxo "Enviar ao CT" (Botão separado) ---
// ==============================================================================

/**
 * Abre o novo modal para enviar ao CT.
 */
function openSendOccurrenceCtModal(groupId) {
    const incident = getFilteredOccurrences().get(groupId);
    if (!incident || incident.records.length === 0) return showToast('Incidente não encontrado.');

    const modal = document.getElementById('send-occurrence-ct-modal');
    const form = document.getElementById('send-occurrence-ct-form');
    const studentSelectSection = document.getElementById('send-ct-student-selection-section');
    const studentSelect = document.getElementById('send-ct-student-select');
    const selectedStudentDisplay = document.getElementById('send-ct-selected-student-display');
    const studentNameDisplay = document.getElementById('send-ct-student-name-display');

    form.reset(); // Limpa o formulário
    document.getElementById('send-ct-group-id').value = groupId;

    // Preenche info do incidente
    const mainRecord = incident.records[0];
    document.getElementById('send-ct-incident-id-display').textContent = groupId;
    document.getElementById('send-ct-incident-type-display').textContent = mainRecord.occurrenceType || 'N/A';

    // Lida com seleção de aluno
    if (incident.studentsInvolved.size > 1) {
        studentSelectSection.classList.remove('hidden');
        selectedStudentDisplay.classList.add('hidden');
        studentSelect.innerHTML = '<option value="">Selecione...</option>';
        incident.studentsInvolved.forEach((student, studentId) => {
            const record = incident.records.find(r => r.studentId === studentId);
            if (record) {
                const option = document.createElement('option');
                option.value = record.id; // Valor da option é o ID do registro individual
                option.textContent = student.name;
                option.dataset.studentId = studentId; // Guarda o ID do aluno
                studentSelect.appendChild(option);
            }
        });
        studentSelect.required = true;
        // Limpa IDs escondidos ao trocar de aluno
        studentSelect.onchange = () => {
             document.getElementById('send-ct-record-id').value = studentSelect.value;
             const selectedOption = studentSelect.options[studentSelect.selectedIndex];
             document.getElementById('send-ct-student-id').value = selectedOption?.dataset?.studentId || '';
        };
        // Inicializa IDs escondidos
        document.getElementById('send-ct-record-id').value = '';
        document.getElementById('send-ct-student-id').value = '';

    } else if (incident.studentsInvolved.size === 1) {
        studentSelectSection.classList.add('hidden');
        selectedStudentDisplay.classList.remove('hidden');
        const [studentEntry] = incident.studentsInvolved.entries(); // Pega o único aluno
        const studentId = studentEntry[0];
        const student = studentEntry[1];
        const record = incident.records.find(r => r.studentId === studentId);

        studentNameDisplay.textContent = student.name;
        document.getElementById('send-ct-record-id').value = record?.id || '';
        document.getElementById('send-ct-student-id').value = studentId;
        studentSelect.required = false;
    } else {
        // Caso sem alunos (não deveria acontecer, mas por segurança)
        showToast('Incidente sem alunos associados.');
        return;
    }

    openModal(modal);
}

/**
 * Lida com a submissão do modal "Enviar ao CT".
 * (MODIFICADO V3: Esta função agora *substitui* a Ação 4 do modal dinâmico)
 * (Esta função será chamada pelo botão "Enviar ao CT" na lista principal)
 */
async function handleSendOccurrenceCtSubmit(e) {
    e.preventDefault();
    const form = e.target;
    if (!form.checkValidity()) {
        form.reportValidity();
        return showToast('Por favor, preencha o número do ofício.');
    }

    const groupId = document.getElementById('send-ct-group-id').value;
    const recordId = document.getElementById('send-ct-record-id').value;
    const studentId = document.getElementById('send-ct-student-id').value;
    const oficioNumber = document.getElementById('send-ct-oficio-number').value.trim();

    if (!recordId || !studentId) {
        return showToast('Erro: Aluno ou registro inválido. Selecione um aluno.');
    }

    // (V3) Pega o registro atual para verificar o status
    const record = state.occurrences.find(r => r.id === recordId);
    if (!record) return showToast("Erro: Registro não encontrado.");

    // (V3) Validação de fluxo: Só deve enviar ao CT se estiver em 'Aguardando Desfecho'
    if (record.statusIndividual !== 'Aguardando Desfecho') {
        showToast(`Erro: O aluno deve estar no status 'Aguardando Desfecho'. Status atual: ${record.statusIndividual}`);
        return;
    }

    const oficioYear = new Date().getFullYear();
    const ctSentDate = new Date().toISOString().split('T')[0]; // Data de hoje

    const dataToUpdate = {
        oficioNumber: oficioNumber,
        oficioYear: oficioYear,
        ctSentDate: ctSentDate,
        statusIndividual: 'Aguardando Devolutiva CT' // (V3) Avança o status
    };

    const historyAction = `Ação 4 (Encaminhamento ao CT) registrada. Ofício: ${oficioNumber}/${oficioYear}.`;

    try {
        // 1. Atualiza o registro individual com os dados do ofício
        await updateRecordWithHistory('occurrence', recordId, dataToUpdate, historyAction, state.userEmail);

        showToast("Registro atualizado com sucesso!");
        closeModal(document.getElementById('send-occurrence-ct-modal'));

        // 2. Busca os dados atualizados para gerar o ofício
        const student = state.students.find(s => s.matricula === studentId);

        if (record && student) {
            // Atualiza dados locais para gerar o ofício
            record.oficioNumber = oficioNumber;
            record.oficioYear = oficioYear;
            record.ctSentDate = ctSentDate;
            record.statusIndividual = 'Aguardando Devolutiva CT'; // Atualiza status localmente também

            // 3. Gera e mostra o ofício
            generateAndShowOccurrenceOficio(record, student, oficioNumber, oficioYear);
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
 */
function handleViewOccurrenceOficio(recordId) {
    if (!recordId) return;

    // Encontra o registro e o incidente associado
    let targetRecord = null;
    let targetIncident = null;
    const allIncidents = getFilteredOccurrences(); // Usa a função de filtro

    for (const incident of allIncidents.values()) {
        const foundRecord = incident.records.find(r => r.id === recordId);
        if (foundRecord) {
            targetRecord = foundRecord;
            targetIncident = incident;
            break;
        }
    }

    if (!targetRecord) return showToast('Registro da ocorrência não encontrado.');
    if (!targetRecord.oficioNumber) return showToast('Este registro não possui um ofício associado.');

    const student = targetIncident?.studentsInvolved.get(targetRecord.studentId);
    if (!student) return showToast('Aluno associado ao registro não encontrado.');

    // Chama a função de geração com os dados encontrados
    generateAndShowOccurrenceOficio(targetRecord, student, targetRecord.oficioNumber, targetRecord.oficioYear);
}


/**
 * (NOVO V3) Lida com o clique no nome de um aluno para avançar a etapa.
 */
function handleNewOccurrenceAction(studentId, groupId, recordId) {
    const incident = getFilteredOccurrences().get(groupId);
    if (!incident) return showToast('Erro: Incidente não encontrado.');

    const student = incident.studentsInvolved.get(studentId);
    if (!student) return showToast('Erro: Aluno não encontrado no incidente.');

    const record = incident.records.find(r => r.id === recordId);
    if (!record) return showToast('Erro: Registro individual não encontrado.');

    // (V3) Determina a próxima ação com base no status ATUAL
    const nextAction = determineNextOccurrenceStep(record.statusIndividual);

    if (nextAction === null) {
        // (V3) Processo já está 'Resolvido'
        showToast('Este processo já foi finalizado.');
        return;
    }

    // (V3) Abre o modal dinâmico com a etapa correta
    openOccurrenceStepModal(student, record, nextAction);
}


// --- Função Principal de Inicialização (Nova) ---

/**
 * Anexa todos os listeners de eventos relacionados a Ocorrências.
 * (MODIFICADO V3: Atualiza listeners para o novo fluxo)
 */
export const initOccurrenceListeners = () => {
    // Botão "Nova Ocorrência"
    document.getElementById('add-occurrence-btn').addEventListener('click', () => openOccurrenceModal());

    // Filtros
    dom.searchOccurrences.addEventListener('input', (e) => { state.filterOccurrences = e.target.value; renderOccurrences(); });
    dom.occurrenceStartDate.addEventListener('change', (e) => { state.filtersOccurrences.startDate = e.target.value; renderOccurrences(); });
    dom.occurrenceEndDate.addEventListener('change', (e) => { state.filtersOccurrences.endDate = e.target.value; renderOccurrences(); });
    document.getElementById('occurrence-filter-type').addEventListener('change', (e) => { state.filtersOccurrences.type = e.target.value; renderOccurrences(); });
    document.getElementById('occurrence-filter-status').addEventListener('change', (e) => { state.filtersOccurrences.status = e.target.value; renderOccurrences(); });

    // Relatório Geral
    dom.generalReportBtn.addEventListener('click', generateAndShowGeneralReport);

    // Formulários
    dom.occurrenceForm.addEventListener('submit', handleOccurrenceSubmit);
    // (V3) Novo handler para o modal de etapas
    dom.followUpForm.addEventListener('submit', handleOccurrenceStepSubmit);
    const sendCtForm = document.getElementById('send-occurrence-ct-form');
    if (sendCtForm) sendCtForm.addEventListener('submit', handleSendOccurrenceCtSubmit);

    // Listener de clique para a lista (delegação de eventos)
    dom.occurrencesListDiv.addEventListener('click', (e) => {
        const button = e.target.closest('button');
        if (!button) return;

        // (V3) Clique direto no aluno para acompanhamento (Ações 2-6)
        const followUpTrigger = e.target.closest('.student-follow-up-trigger');
        if (followUpTrigger) {
            e.stopPropagation();
            const groupId = followUpTrigger.dataset.groupId;
            const studentId = followUpTrigger.dataset.studentId;
            const recordId = followUpTrigger.dataset.recordId; // (V3) Passa o ID do registro
            handleNewOccurrenceAction(studentId, groupId, recordId);
            return;
        }

        // Ação do menu Kebab
        if (button.classList.contains('kebab-menu-btn')) {
            e.stopPropagation();
            const dropdown = button.nextElementSibling;
            if (dropdown) {
                document.querySelectorAll('.kebab-menu-dropdown').forEach(d => {
                    if (d !== dropdown) d.classList.add('hidden');
                });
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

        const groupId = button.dataset.groupId;
        e.stopPropagation();

        if (button.classList.contains('notification-btn')) {
            openStudentSelectionModal(groupId);
        } else if (button.classList.contains('record-btn')) {
            openOccurrenceRecordModal(groupId);
        } else if (button.classList.contains('send-occurrence-ct-btn')) {
            openSendOccurrenceCtModal(groupId);
        } else if (button.classList.contains('kebab-action-btn')) {
            const action = button.dataset.action;
            if (action === 'edit') handleEditOccurrence(groupId);
            else if (action === 'delete') handleDelete('occurrence', groupId);
            else if (action === 'history') openHistoryModal(groupId);
            // (V3) Ação 'follow-up' removida do kebab

            const dropdown = button.closest('.kebab-menu-dropdown');
            if(dropdown) dropdown.classList.add('hidden'); // Fecha o menu kebab
        }
    });

    // (V3) Listener para o rádio de contato no modal de Acompanhamento (Ação 3)
    document.querySelectorAll('input[name="follow-up-contact-succeeded"]').forEach(radio =>
        radio.addEventListener('change', (e) => {
            toggleOccurrenceContactFields(e.target.value === 'yes');
        })
    );

    // Listeners para fechar o novo modal "Enviar ao CT"
    const closeSendCtBtn = document.getElementById('close-send-ct-modal-btn');
    const cancelSendCtBtn = document.getElementById('cancel-send-ct-modal-btn');
    const sendCtModal = document.getElementById('send-occurrence-ct-modal');
    if (closeSendCtBtn && sendCtModal) closeSendCtBtn.onclick = () => closeModal(sendCtModal);
    if (cancelSendCtBtn && sendCtModal) cancelSendCtBtn.onclick = () => closeModal(sendCtModal);
};

