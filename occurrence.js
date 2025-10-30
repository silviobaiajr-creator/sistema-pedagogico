// =================================================================================
// ARQUIVO: occurrence.js (Fluxo V3 - UI Refinada + Papéis)
// RESPONSABILIDADE: Gerenciar toda a lógica, UI e eventos da
// funcionalidade "Ocorrências".
//
// CORREÇÃO (VISUAL - 29/10/2025):
// 1. Corrigida a sintaxe dos comentários dentro do HTML gerado na função
//    `renderOccurrences` para usar `<!-- ... -->` em vez de `{/* ... */}`.
//
// CORREÇÃO (LOGIN - 29/10/2025):
// ... (histórico anterior mantido) ...
// =================================================================================

import { state, dom } from './state.js';
import { showToast, openModal, closeModal, getStatusBadge, formatDate, formatTime } from './utils.js';
import { getCollectionRef, getCounterDocRef, updateRecordWithHistory, addRecordWithHistory, deleteRecord, getIncidentByGroupId as fetchIncidentById } from './firestore.js'; // Renomeado para clareza
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
import { writeBatch, doc, collection, query, where, getDocs, runTransaction } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from './firebase.js';

// Mapeia o tipo de ação para o título do modal
const occurrenceActionTitles = {
    'convocacao': 'Ação 2: Agendar Convocação',
    'contato_familia': 'Ação 3: Registrar Contato com Família',
    'desfecho_ou_ct': 'Ação 4 ou 6: Encaminhar ao CT ou Dar Parecer', // Modificado nome
    'devolutiva_ct': 'Ação 5: Registrar Devolutiva do CT',
    'parecer_final': 'Ação 6: Dar Parecer Final'
};

// Mapeia o status atual para o próximo status
const occurrenceNextStatusMap = {
    'Aguardando Convocação': 'Aguardando Contato',       // Após Ação 2
    'Aguardando Contato': 'Aguardando Desfecho',        // Após Ação 3 (Sim OU Não - CORRIGIDO Plano 1a)
    'Aguardando Desfecho': 'Aguardando Desfecho', // Status intermediário antes da decisão 4/6
    // Status após decisão 4/6 são definidos na lógica de submit
};

// (NOVO - Papéis) Ícones para os papéis
// (MODIFICADO - Login) Adicionado export
export const roleIcons = {
    'Vítima': 'fas fa-user-shield text-blue-600',
    'Agente': 'fas fa-gavel text-red-600', // Martelo conforme escolhido
    'Testemunha': 'fas fa-eye text-green-600',
    'Envolvido': 'fas fa-user text-gray-500' // Ícone genérico conforme escolhido
};
// (MODIFICADO - Login) Adicionado export
export const defaultRole = 'Envolvido'; // Papel padrão ao adicionar

// Variável temporária para guardar o aluno enquanto o papel é selecionado
let studentPendingRoleSelection = null;
let editingRoleId = null; // Guarda o ID do aluno cujo papel está sendo editado

// --- Funções de UI ---

/**
 * (MODIFICADO - Papéis) Renderiza as tags dos alunos selecionados com ícones de papel e botão de edição.
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
        tag.className = 'bg-indigo-100 text-indigo-800 text-sm font-medium me-2 px-2.5 py-1 rounded-full flex items-center gap-1.5';
        const iconClass = roleIcons[role] || roleIcons[defaultRole];

        tag.innerHTML = `
            <i class="${iconClass} fa-fw" title="${role}"></i>
            <span>${student.name}</span>
            <span class="text-xs text-indigo-500 font-normal">(${student.class || 'S/ Turma'})</span>
            <button type="button" class="edit-role-btn ml-1 text-gray-400 hover:text-indigo-600" data-id="${studentId}" title="Editar Papel">
                <i class="fas fa-pencil-alt fa-xs"></i>
            </button>
            <button type="button" class="remove-tag-btn ms-1 text-indigo-600 hover:text-indigo-800">&times;</button>
        `;

        // Listener para remover a tag
        tag.querySelector('.remove-tag-btn').addEventListener('click', () => {
            state.selectedStudents.delete(studentId);
            renderTags();
        });

        // Listener para editar o papel
        tag.querySelector('.edit-role-btn').addEventListener('click', (e) => {
            e.stopPropagation(); // Impede que o listener de clique do documento feche o dropdown imediatamente
            openRoleEditDropdown(e.currentTarget, studentId);
        });

        tagsContainerElement.appendChild(tag);
    });
};

/**
 * (NOVO - Papéis) Abre o dropdown para editar o papel de um aluno já adicionado.
 */
const openRoleEditDropdown = (buttonElement, studentId) => {
    const dropdown = document.getElementById('role-edit-dropdown');
    editingRoleId = studentId; // Guarda o ID para saber qual aluno atualizar

    // Posiciona o dropdown perto do botão clicado
    const rect = buttonElement.getBoundingClientRect();
    dropdown.style.top = `${rect.bottom + window.scrollY}px`;
    dropdown.style.left = `${rect.left + window.scrollX}px`;
    dropdown.classList.remove('hidden');

    // Adiciona listener para fechar se clicar fora (apenas uma vez)
    const closeListener = (e) => {
        if (!dropdown.contains(e.target) && e.target !== buttonElement) {
            dropdown.classList.add('hidden');
            document.removeEventListener('click', closeListener);
            editingRoleId = null;
        }
    };
    // Adiciona um pequeno delay para não capturar o mesmo clique que abriu
    setTimeout(() => document.addEventListener('click', closeListener), 0);
};

/**
 * (MODIFICADO - Papéis) Gerencia a UI de seleção de múltiplos alunos e a seleção/edição de papéis.
 */
export const setupStudentTagInput = (inputElement, suggestionsElement, tagsContainerElement) => {
    const roleSelectionPanel = document.getElementById('role-selection-panel');
    const roleSelectionStudentName = document.getElementById('role-selection-student-name');
    const roleSelectButtons = roleSelectionPanel.querySelectorAll('.role-select-btn');
    const roleEditDropdown = document.getElementById('role-edit-dropdown');
    const roleEditOptions = roleEditDropdown.querySelectorAll('.role-edit-option');

    // Limpa estado anterior ao configurar
    studentPendingRoleSelection = null;
    roleSelectionPanel.classList.add('hidden');
    roleEditDropdown.classList.add('hidden');

    // --- Lógica de Sugestões ---
    inputElement.addEventListener('input', () => {
        const value = inputElement.value.toLowerCase();
        suggestionsElement.innerHTML = '';
        roleSelectionPanel.classList.add('hidden'); // Esconde painel de papel ao digitar
        studentPendingRoleSelection = null;

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
                item.className = 'suggestion-item p-2 cursor-pointer hover:bg-indigo-50'; // Tailwind
                item.textContent = student.name;
                item.addEventListener('click', () => {
                    // Guarda o aluno e mostra o painel de seleção de papel
                    studentPendingRoleSelection = student;
                    roleSelectionStudentName.textContent = student.name;
                    roleSelectionPanel.classList.remove('hidden');
                    suggestionsElement.classList.add('hidden'); // Esconde sugestões
                    inputElement.value = ''; // Limpa input
                    inputElement.focus(); // Mantém o foco próximo
                });
                suggestionsElement.appendChild(item);
            });
        } else {
            suggestionsElement.classList.add('hidden');
        }
    });

    // --- Lógica de Seleção de Papel (Painel Inline) ---
    roleSelectButtons.forEach(button => {
        button.addEventListener('click', () => {
            if (studentPendingRoleSelection) {
                const selectedRole = button.dataset.role;
                // Adiciona ao estado com o papel selecionado
                state.selectedStudents.set(studentPendingRoleSelection.matricula, {
                    student: studentPendingRoleSelection,
                    role: selectedRole
                });
                studentPendingRoleSelection = null; // Limpa aluno pendente
                roleSelectionPanel.classList.add('hidden'); // Esconde o painel
                renderTags(); // Atualiza a exibição das tags
            }
        });
    });

    // --- Lógica de Edição de Papel (Dropdown) ---
    roleEditOptions.forEach(option => {
        option.addEventListener('click', () => {
            if (editingRoleId && state.selectedStudents.has(editingRoleId)) {
                const newRole = option.dataset.role;
                const currentData = state.selectedStudents.get(editingRoleId);
                currentData.role = newRole; // Atualiza o papel no estado
                state.selectedStudents.set(editingRoleId, currentData); // Garante a atualização (embora Map seja por referência)
                roleEditDropdown.classList.add('hidden'); // Esconde dropdown
                renderTags(); // Re-renderiza as tags
                editingRoleId = null; // Limpa ID em edição
            }
        });
    });

    // --- Lógica para Fechar Elementos Flutuantes ---
    document.addEventListener('click', (e) => {
        // Fecha sugestões se clicar fora
        if (!suggestionsElement.contains(e.target) && e.target !== inputElement) {
            suggestionsElement.classList.add('hidden');
        }
        // Fecha painel de seleção de papel se clicar fora
        if (!roleSelectionPanel.contains(e.target) && !e.target.closest('.suggestion-item')) {
            roleSelectionPanel.classList.add('hidden');
            studentPendingRoleSelection = null;
        }
        // O dropdown de edição já tem seu próprio listener para fechar
    });

    // Renderiza tags iniciais (importante para o modo de edição)
    renderTags();
};

/**
 * Filtra e agrupa ocorrências.
 * (MODIFICADO - Papéis) Carrega participantes com papéis.
 */
export const getFilteredOccurrences = () => {
    // 1. Agrupa por incidente
    const groupedByIncident = state.occurrences.reduce((acc, occ) => {
        // (CORREÇÃO) Pula registros inválidos
        if (!occ || !occ.studentId) return acc;

        const groupId = occ.occurrenceGroupId || `individual-${occ.id}`;
        if (!acc.has(groupId)) {
            // Inicializa o incidente
            acc.set(groupId, {
                id: groupId,
                records: [],
                // (MODIFICADO - Papéis) Armazena a estrutura completa { student, role }
                participantsInvolved: new Map(), // Renomeado para clareza
                overallStatus: 'Aguardando Convocação' // Status inicial (será recalculado)
            });
        }
        const incident = acc.get(groupId);
        incident.records.push(occ);

        // (MODIFICADO - Papéis) Encontra o participante (aluno + papel)
        // A estrutura salva em `occ.participants` deve ser [{ studentId: '...', role: '...' }]
        const participantData = occ.participants?.find(p => p.studentId === occ.studentId);
        const student = state.students.find(s => s.matricula === occ.studentId);

        if (student && !incident.participantsInvolved.has(student.matricula)) {
             // Armazena o objeto student e o role
             incident.participantsInvolved.set(student.matricula, {
                 student: student,
                 role: participantData?.role || defaultRole // Usa papel salvo ou padrão
             });
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

        // Recalcula status geral (lógica inalterada)
        const allResolved = incident.records.every(r => r.statusIndividual === 'Resolvido');
        incident.overallStatus = allResolved ? 'Finalizada' : 'Pendente';

        // Aplica filtros (lógica inalterada, exceto busca por aluno)
        if (startDate && mainRecord.date < startDate) continue;
        if (endDate && mainRecord.date > endDate) continue;
        if (status !== 'all' && incident.overallStatus !== status) continue;
        if (type !== 'all' && mainRecord.occurrenceType !== type) continue;

        if (studentSearch) {
            // (MODIFICADO - Papéis) Busca no nome do aluno dentro da estrutura participantsInvolved
            const hasMatchingStudent = [...incident.participantsInvolved.values()].some(p =>
                p.student.name.toLowerCase().includes(studentSearch)
            );
            if (!hasMatchingStudent) continue;
        }
        filteredIncidents.set(groupId, incident);
    }
    return filteredIncidents;
};


/**
 * Renderiza a lista de ocorrências.
 * (MODIFICADO - Papéis) Exibe ícones de papel e ajusta botões.
 * (MODIFICADO - Plano 1b) Adiciona disabled em botões de ocorrências finalizadas.
 * (MODIFICADO - Plano 3c) Move botão "Editar Fato" para fora do kebab.
 * (CORREÇÃO - VISUAL) Usa sintaxe de comentário HTML correta.
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
        const isFinalizada = incident.overallStatus === 'Finalizada'; // (NOVO - Plano 1b)

        const studentDetailsHTML = [...incident.participantsInvolved.values()] // (MODIFICADO - Papéis) Itera sobre participantes
            .map(participant => {
                const { student, role } = participant; // Pega student e role
                if (!student) return '';
                const record = incident.records.find(r => r && r.studentId === student.matricula);
                const recordId = record?.id || '';
                const status = record?.statusIndividual || 'Aguardando Convocação';
                const isMatch = studentSearch && student.name.toLowerCase().includes(studentSearch);
                const nameClass = isMatch ? 'font-bold text-yellow-800' : 'font-medium text-gray-700';
                let borderClass = isMatch ? 'border-yellow-300 bg-yellow-50' : 'border-gray-200 bg-gray-50';
                let hoverClass = isMatch ? 'hover:bg-yellow-100' : 'hover:bg-indigo-50';
                const iconClass = roleIcons[role] || roleIcons[defaultRole]; // (NOVO - Papéis) Pega ícone do papel
                const isIndividualResolvido = record?.statusIndividual === 'Resolvido'; // (NOVO - Plano 1b)

                // Botão Ver Ofício (mantido)
                const viewOficioBtn = record?.oficioNumber ? `
                    <button type="button"
                            class="view-occurrence-oficio-btn text-green-600 hover:text-green-900 text-xs font-semibold py-1 px-2 rounded-md bg-green-50 hover:bg-green-100"
                            data-record-id="${recordId}"
                            title="Ver Ofício Nº ${record.oficioNumber}/${record.oficioYear || ''}">
                        <i class="fas fa-file-alt"></i> Ver Ofício
                    </button>
                ` : '';

                // Botão Notificação condicional (mantido)
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

                // --- INÍCIO DA MODIFICAÇÃO (Organização Vertical Conforme Solicitado + CORREÇÃO VISUAL) ---
                return `
                    <div class="py-2 px-3 rounded-lg border ${borderClass} ${hoverClass} transition-colors">
                        <!-- (MODIFICADO - Plano 1b) Adiciona disabled se resolvido -->
                        <button type="button"
                                class="student-follow-up-trigger flex items-center gap-1.5 w-full text-left ${isIndividualResolvido ? 'opacity-50 cursor-not-allowed' : ''}"
                                data-group-id="${incident.id}"
                                data-student-id="${student.matricula}"
                                data-record-id="${recordId}"
                                title="${isIndividualResolvido ? 'Processo individual finalizado' : `Abrir acompanhamento de ${student.name}`}"
                                ${isIndividualResolvido ? 'disabled' : ''}>
                            <!-- (NOVO - Papéis) Adiciona ícone do papel -->
                            <i class="${iconClass} fa-fw w-4 text-center" title="${role}"></i>
                            <span class="${nameClass}">${student.name}</span>
                        </button>

                        <div class="flex items-center flex-wrap gap-2 mt-1 pt-1 border-t ${borderClass}">
                            ${getStatusBadge(status)}
                            ${notificationBtn}
                            <!-- (NOVO - Plano 1c) Botão Editar Ação Individual (A ser implementado) -->
                            <!-- <button class="edit-occurrence-action-btn ..."><i class="fas fa-pencil-alt"></i> Editar Ação</button> -->
                            <!-- (NOVO - Plano 1c) Botão Excluir/Reset Ação Individual (A ser implementado) -->
                            <!-- <button class="delete-occurrence-action-btn ..."><i class="fas fa-trash"></i> Resetar Ação</button> -->
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
                        <!-- (MODIFICADO - Plano 3c) Botão Editar Fato movido para cá -->
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
                                <!-- Botão Editar Fato REMOVIDO daqui -->
                                <button class="kebab-action-btn menu-item w-full text-left" data-action="history" data-group-id="${incident.id}"><i class="fas fa-history mr-2 w-4"></i>Histórico</button>
                                <!-- (MODIFICADO - Plano 1b) Adiciona disabled se finalizada -->
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

/**
 * Abre o modal para registrar ou editar os dados COLETIVOS (Ação 1).
 * (MODIFICADO - Papéis) Carrega participantes com papéis ao editar.
 */
export const openOccurrenceModal = (incidentToEdit = null) => {
    dom.occurrenceForm.reset();
    state.selectedStudents.clear(); // Limpa o Map de alunos selecionados

    if (incidentToEdit) {
        const mainRecord = incidentToEdit.records[0];
        document.getElementById('modal-title').innerText = 'Editar Fato da Ocorrência';
        document.getElementById('occurrence-group-id').value = incidentToEdit.id;

        // (MODIFICADO - Papéis) Popula state.selectedStudents com a estrutura { student, role }
        incidentToEdit.participantsInvolved.forEach((data, studentId) => {
            state.selectedStudents.set(studentId, { student: data.student, role: data.role });
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

    // Configura o input de alunos (agora com lógica de papéis)
    const studentInput = document.getElementById('student-search-input');
    const suggestionsDiv = document.getElementById('student-suggestions');
    const tagsContainer = document.getElementById('student-tags-container');
    setupStudentTagInput(studentInput, suggestionsDiv, tagsContainer); // Esta função agora chama renderTags internamente

    openModal(dom.occurrenceModal);
};

/**
 * Alterna a visibilidade e obrigatoriedade dos campos de contato (Ação 3).
 * (Inalterado)
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
 * (NOVO - Plano 3b) Alterna a visibilidade dos fieldsets de Ação 4 e 6 com base na escolha.
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

    // Habilita/desabilita e torna obrigatório/opcional
    if (oficioInput) { oficioInput.disabled = !showCt; oficioInput.required = showCt; }
    if (dateCtInput) { dateCtInput.disabled = !showCt; dateCtInput.required = showCt; }
    if (parecerInput) { parecerInput.disabled = !showParecer; parecerInput.required = showParecer; }
};


/**
 * Abre o modal de ACOMPANHAMENTO e exibe APENAS a etapa atual.
 * (MODIFICADO - Plano 3b) Esconde/mostra campos da Ação 4/6 com base nos rádios.
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

    // Esconde todos os grupos dinâmicos e desabilita campos
    document.querySelectorAll('.dynamic-occurrence-step').forEach(group => {
        group.classList.add('hidden');
        group.querySelectorAll('input, select, textarea, button').forEach(el => {
            el.disabled = true;
            el.required = false;
        });
        // Desmarca rádios
        group.querySelectorAll('input[type="radio"]').forEach(radio => radio.checked = false);
    });
    // Esconde especificamente os fieldsets da Ação 4 e 6
    toggleDesfechoFields(null);

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

                    const currentSucceededValue = record.contactSucceeded; // Guarda o valor atual
                    const radioChecked = document.querySelector(`input[name="follow-up-contact-succeeded"][value="${currentSucceededValue}"]`);
                    if (radioChecked) {
                        radioChecked.checked = true;
                    } else {
                        radios.forEach(r => r.checked = false); // Garante que nenhum esteja marcado se o valor for null
                    }
                    // A visibilidade dos campos depende do valor carregado
                    toggleOccurrenceContactFields(currentSucceededValue === 'yes');
                    document.getElementById('follow-up-contact-type').value = record.contactType || '';
                    document.getElementById('follow-up-contact-date').value = record.contactDate || '';
                    document.getElementById('follow-up-family-actions').value = record.providenciasFamilia || '';
                }
            }
            break;

        case 'desfecho_ou_ct': // Ação 4 ou 6 (Decisão)
             if (record.contactSucceeded == null) { // Checa se a Ação 3 foi preenchida
                showToast('Erro: Preencha a Ação 3 (Contato com Família) primeiro.');
                requiredFieldsValid = false;
            } else {
                // Mostra o grupo de escolha (rádios)
                const choiceGroup = document.getElementById('group-desfecho-choice');
                if (choiceGroup) {
                    choiceGroup.classList.remove('hidden');
                    const choiceRadios = choiceGroup.querySelectorAll('input[name="follow-up-desfecho-choice"]');
                    choiceRadios.forEach(r => r.disabled = false); // Habilita os rádios

                    // Verifica se já existe uma decisão salva (CT ou Parecer)
                    // Usa o campo 'desfechoChoice' que guardamos ao salvar
                    const currentChoice = record.desfechoChoice || null;

                    // Marca o rádio correspondente, se houver escolha salva
                    if (currentChoice) {
                        const radioToCheck = choiceGroup.querySelector(`input[value="${currentChoice}"]`);
                        if (radioToCheck) radioToCheck.checked = true;
                        // Mostra o fieldset correspondente à escolha salva
                        toggleDesfechoFields(currentChoice);
                    } else {
                         // Se não há escolha salva, deixa desmarcado e ambos fieldsets escondidos
                         toggleDesfechoFields(null);
                    }
                }

                // Preenche os dados nos fieldsets (mesmo que escondidos inicialmente)
                const oficioInput = document.getElementById('follow-up-oficio-number');
                const dateCtInput = document.getElementById('follow-up-ct-sent-date');
                const parecerInput = document.getElementById('follow-up-parecer-final');
                if(oficioInput) oficioInput.value = record.oficioNumber || '';
                if(dateCtInput) dateCtInput.value = record.ctSentDate || '';
                if(parecerInput) parecerInput.value = record.parecerFinal || '';
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
            // Verifica se a Ação 5 (se aplicável) ou Ação 3 foi preenchida
            if (record.oficioNumber && record.ctFeedback == null) {
                showToast('Erro: Preencha a Ação 5 (Devolutiva do CT) primeiro.');
                requiredFieldsValid = false;
            } else if (!record.oficioNumber && record.contactSucceeded == null) {
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


// --- Funções de Handler ---

/**
 * Lida com a submissão do formulário de ocorrências (Ação 1: Criação/Edição do FATO COLETIVO).
 * (MODIFICADO - Papéis) Salva a estrutura `participants` com papéis.
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

    // (NOVO - Papéis) Cria o array de participantes com { studentId, role }
    const participants = Array.from(state.selectedStudents.entries()).map(([studentId, data]) => ({
        studentId: studentId,
        role: data.role
    }));

    // Verifica se há pelo menos uma Vítima ou Agente (opcional, mas recomendado)
    const hasVictimOrAgent = participants.some(p => p.role === 'Vítima' || p.role === 'Agente');
    if (!hasVictimOrAgent) {
        // Poderia apenas mostrar um aviso ou tornar obrigatório, dependendo da regra de negócio.
        // Por ora, vamos permitir salvar sem Vítima/Agente definidos.
        console.warn("Nenhum aluno definido como Vítima ou Agente.");
        // showToast("Aviso: É recomendado definir pelo menos uma Vítima ou Agente.");
    }

    const collectiveData = {
        date: document.getElementById('occurrence-date').value,
        occurrenceType: document.getElementById('occurrence-type').value,
        description: document.getElementById('description').value.trim(),
        providenciasEscola: document.getElementById('providencias-escola').value.trim(),
        // (MODIFICADO - Papéis) Salva o array de participantes
        participants: participants
    };

    if (!collectiveData.providenciasEscola) {
        showToast("O campo 'Providências da Escola' é obrigatório.");
        document.getElementById('providencias-escola').focus();
        return;
    }

    try {
        if (groupId) {
            // --- MODO DE EDIÇÃO DO FATO ---
            const originalIncident = await fetchIncidentById(groupId); // Usa a função otimizada
            if (!originalIncident) throw new Error("Incidente original não encontrado para edição.");

            const historyAction = "Dados gerais do fato (Ação 1) atualizados (incluindo participantes/papéis).";
            const batch = writeBatch(db);
            const currentParticipantIds = participants.map(p => p.studentId);

            // Atualiza registros existentes ou adiciona novos
            for (const participant of participants) {
                const studentId = participant.studentId;
                const existingRecord = originalIncident.records.find(r => r.studentId === studentId);

                if (existingRecord) {
                    // Atualiza dados coletivos + participantes no registro existente
                    const recordRef = doc(getCollectionRef('occurrence'), existingRecord.id);
                    batch.update(recordRef, collectiveData); // collectiveData já contém 'participants'
                } else {
                    // Cria novo registro para aluno adicionado durante edição
                    const newRecordRef = doc(collection(db, getCollectionRef('occurrence').path));
                    const newRecordData = {
                        ...collectiveData, // Já inclui 'participants'
                        studentId,
                        occurrenceGroupId: groupId,
                        statusIndividual: 'Aguardando Convocação',
                        meetingDate: null, meetingTime: null, contactSucceeded: null,
                        contactType: null, contactDate: null, providenciasFamilia: null,
                        oficioNumber: null, oficioYear: null, ctSentDate: null,
                        ctFeedback: null, parecerFinal: null,
                        desfechoChoice: null, // Campo para decisão 4/6
                        createdAt: new Date(), createdBy: state.userEmail,
                        history: [{ action: 'Incidente registrado (aluno adicionado durante edição)', user: state.userEmail, timestamp: new Date() }]
                    };
                    batch.set(newRecordRef, newRecordData);
                }
            }

            // Remove registros de alunos que foram desvinculados
            const removedStudentIds = originalIncident.records
                .map(r => r.studentId)
                .filter(id => !currentParticipantIds.includes(id));

            for (const studentId of removedStudentIds) {
                const recordToDelete = originalIncident.records.find(r => r.studentId === studentId);
                if (recordToDelete) {
                    batch.delete(doc(getCollectionRef('occurrence'), recordToDelete.id));
                }
            }

            // Adiciona histórico a todos os registros que PERMANECERAM no incidente
            const recordsToUpdateHistoryQuery = query(getCollectionRef('occurrence'), where('occurrenceGroupId', '==', groupId));
            const recordsToUpdateHistorySnap = await getDocs(recordsToUpdateHistoryQuery);
            recordsToUpdateHistorySnap.docs.forEach(docSnapshot => {
                 // Adiciona histórico apenas aos que ainda fazem parte (foram atualizados ou mantidos)
                 if (currentParticipantIds.includes(docSnapshot.data().studentId)) {
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

            // Cria um registro individual para cada participante
            for (const participant of participants) {
                const recordData = {
                    ...collectiveData, // Já inclui 'participants' e outros dados coletivos
                    studentId: participant.studentId, // ID do aluno deste registro específico
                    occurrenceGroupId: newGroupId,
                    statusIndividual: 'Aguardando Convocação', // Status inicial individual
                    // Inicializa campos individuais como null
                    meetingDate: null, meetingTime: null, contactSucceeded: null,
                    contactType: null, contactDate: null, providenciasFamilia: null,
                    oficioNumber: null, oficioYear: null, ctSentDate: null,
                    ctFeedback: null, parecerFinal: null,
                    desfechoChoice: null // Campo para decisão 4/6
                };
                // Adiciona o registro com histórico inicial
                await addRecordWithHistory('occurrence', recordData, 'Incidente registrado (Ação 1)', state.userEmail);
            }
            showToast(`Ocorrência ${newGroupId} registrada com sucesso!`);
        }
        closeModal(dom.occurrenceModal);
        // A lista será atualizada automaticamente pelo listener onSnapshot
    } catch (error) {
        console.error("Erro ao salvar ocorrência:", error);
        showToast('Erro ao salvar a ocorrência.');
    }
}


/**
 * Lida com a submissão do formulário de ACOMPANHAMENTO (Ações 2-6).
 * (MODIFICADO - Plano 1a) Avança status mesmo se contato="Não".
 * (MODIFICADO - Plano 2a) Gera notificação após salvar Ação 2.
 * (MODIFICADO - Plano 3b) Lê a escolha (CT ou Parecer) dos rádios na Ação 4/6.
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

    // Busca o registro original NO ESTADO ATUAL (pode ter sido atualizado)
    const record = state.occurrences.find(r => r.id === recordId);
    if (!record) return showToast("Erro: Registro original não encontrado.");

    let dataToUpdate = {};
    let historyAction = "";
    let nextStatus = record.statusIndividual; // Assume que não muda, será alterado abaixo se necessário

    try {
        switch (actionType) {
            case 'convocacao': // Ação 2
                dataToUpdate = {
                    meetingDate: document.getElementById('follow-up-meeting-date').value,
                    meetingTime: document.getElementById('follow-up-meeting-time').value,
                };
                if (!dataToUpdate.meetingDate || !dataToUpdate.meetingTime) {
                    return showToast('Data e Horário da convocação são obrigatórios.');
                }
                historyAction = `Ação 2 (Convocação) agendada para ${formatDate(dataToUpdate.meetingDate)} às ${formatTime(dataToUpdate.meetingTime)}.`;
                nextStatus = occurrenceNextStatusMap['Aguardando Convocação']; // Próximo status é 'Aguardando Contato'
                break;

            case 'contato_familia': // Ação 3
                const contactSucceededRadio = document.querySelector('input[name="follow-up-contact-succeeded"]:checked');
                const contactSucceeded = contactSucceededRadio ? contactSucceededRadio.value : null;

                if (!contactSucceeded) return showToast('Selecione se conseguiu contato (Sim ou Não).');

                if (contactSucceeded === 'yes') {
                     dataToUpdate = {
                        contactSucceeded: 'yes',
                        contactType: document.getElementById('follow-up-contact-type').value,
                        contactDate: document.getElementById('follow-up-contact-date').value,
                        providenciasFamilia: document.getElementById('follow-up-family-actions').value,
                    };
                    if (!dataToUpdate.contactType || !dataToUpdate.contactDate || !dataToUpdate.providenciasFamilia) {
                         return showToast('Preencha Tipo, Data do Contato e Providências da Família.');
                    }
                    historyAction = `Ação 3 (Contato) registrada com sucesso (Família ciente). Providências: ${dataToUpdate.providenciasFamilia}`;
                } else { // contactSucceeded === 'no'
                    dataToUpdate = {
                        contactSucceeded: 'no',
                        // Limpa campos relacionados ao contato bem-sucedido
                        contactType: null, contactDate: null, providenciasFamilia: null,
                    };
                    historyAction = `Ação 3 (Contato) registrada sem sucesso.`;
                }
                // (MODIFICADO - Plano 1a) Avança para 'Aguardando Desfecho' em AMBOS os casos (Sim ou Não)
                nextStatus = occurrenceNextStatusMap['Aguardando Contato'];
                break;

            case 'desfecho_ou_ct': // Ação 4 ou 6 (Decisão)
                // (MODIFICADO - Plano 3b) Lê a escolha do rádio
                const desfechoChoiceRadio = document.querySelector('input[name="follow-up-desfecho-choice"]:checked');
                const desfechoChoice = desfechoChoiceRadio ? desfechoChoiceRadio.value : null;

                if (!desfechoChoice) {
                    return showToast("Erro: Escolha uma opção - Encaminhar ao CT OU Dar Parecer Final.");
                }

                if (desfechoChoice === 'ct') { // Ação 4 (CT)
                    const oficioNumber = document.getElementById('follow-up-oficio-number').value.trim();
                    const ctSentDate = document.getElementById('follow-up-ct-sent-date').value;

                    if (!oficioNumber || !ctSentDate) {
                        return showToast("Erro: Preencha o Nº do Ofício e a Data de Envio para encaminhar ao CT.");
                    }

                    dataToUpdate = {
                        oficioNumber, ctSentDate,
                        oficioYear: new Date(ctSentDate).getFullYear() || new Date().getFullYear(),
                        // Garante que o parecer final seja limpo se escolher CT
                        parecerFinal: null,
                        // (NOVO) Guarda a escolha feita
                        desfechoChoice: 'ct'
                    };
                    historyAction = `Ação 4 (Encaminhamento ao CT) registrada. Ofício: ${oficioNumber}/${dataToUpdate.oficioYear}.`;
                    nextStatus = 'Aguardando Devolutiva CT'; // Próximo status

                    // Tenta gerar Ofício aqui
                    const studentIdCt = form.dataset.studentId;
                    const studentCt = state.students.find(s => s.matricula === studentIdCt);
                    if (studentCt) {
                        // Passa os dados atualizados para a função gerar o ofício
                         generateAndShowOccurrenceOficio({ ...record, ...dataToUpdate }, studentCt, dataToUpdate.oficioNumber, dataToUpdate.oficioYear);
                    } else {
                         showToast("Ofício não gerado: Aluno não encontrado.");
                    }

                } else { // desfechoChoice === 'parecer' -> Ação 6 (Parecer Direto)
                     const parecerFinal = document.getElementById('follow-up-parecer-final').value.trim();
                     if (!parecerFinal) {
                         return showToast("Erro: Preencha o Parecer/Desfecho.");
                     }
                     dataToUpdate = {
                        parecerFinal,
                        // Garante que dados do CT sejam limpos se escolher Parecer
                        oficioNumber: null, ctSentDate: null, oficioYear: null, ctFeedback: null,
                        // (NOVO) Guarda a escolha feita
                        desfechoChoice: 'parecer'
                    };
                    historyAction = `Ação 6 (Parecer Final) registrada diretamente.`;
                    nextStatus = 'Resolvido'; // Finaliza
                }
                break;

            case 'devolutiva_ct': // Ação 5
                dataToUpdate = {
                    ctFeedback: document.getElementById('follow-up-ct-feedback').value.trim(),
                };
                 if (!dataToUpdate.ctFeedback) {
                     return showToast("Erro: Preencha a Devolutiva do CT.");
                 }
                historyAction = `Ação 5 (Devolutiva do CT) registrada.`;
                nextStatus = 'Aguardando Parecer Final'; // Próximo status
                break;

            case 'parecer_final': // Ação 6 (Final, após CT ou direto)
                dataToUpdate = {
                    parecerFinal: document.getElementById('follow-up-parecer-final').value.trim(),
                };
                 if (!dataToUpdate.parecerFinal) {
                     return showToast("Erro: Preencha o Parecer/Desfecho final.");
                 }
                historyAction = record.oficioNumber
                   ? `Ação 6 (Parecer Final) registrada após devolutiva do CT.`
                   : `Ação 6 (Parecer Final) registrada diretamente após contato.`;
                nextStatus = 'Resolvido'; // Finaliza
                break;

            default: showToast("Erro: Tipo de ação desconhecido."); return;
        }
    } catch (collectError) {
        console.error("Erro ao coletar dados do formulário:", collectError);
        showToast("Erro ao processar os dados do formulário.");
        return;
    }

    // Define o próximo status individual
    dataToUpdate.statusIndividual = nextStatus;

    try {
        await updateRecordWithHistory('occurrence', recordId, dataToUpdate, historyAction, state.userEmail);
        showToast("Etapa salva com sucesso!");

        // (MODIFICADO - Plano 2a) Gera notificação após salvar Ação 2
        if (actionType === 'convocacao') {
            const studentId = form.dataset.studentId;
            const student = state.students.find(s => s.matricula === studentId);
            if (student) {
                // Busca o incidente completo usando o ID do grupo do registro atualizado
                const incident = await fetchIncidentById(record.occurrenceGroupId);
                // Cria uma versão atualizada do registro EM MEMÓRIA para a notificação
                const updatedRecordForNotification = { ...record, ...dataToUpdate };

                if (incident) {
                    // Encontra e atualiza o registro específico dentro do incidente (EM MEMÓRIA)
                    const recordIndex = incident.records.findIndex(r => r.id === recordId);
                    if (recordIndex > -1) {
                        incident.records[recordIndex] = updatedRecordForNotification;
                    } else {
                        // Se não encontrou (improvável), adiciona
                        incident.records.push(updatedRecordForNotification);
                    }
                    // Chama a função para gerar e mostrar a notificação
                    openIndividualNotificationModal(incident, student);
                    // O modal de acompanhamento fechará DEPOIS que a notificação for gerada
                    closeModal(dom.followUpModal);
                } else {
                    showToast("Dados salvos, mas erro ao buscar incidente para gerar notificação.");
                    closeModal(dom.followUpModal); // Fecha mesmo se não gerar notif
                }
            } else {
                 showToast("Dados salvos, mas erro ao buscar aluno para gerar notificação.");
                 closeModal(dom.followUpModal); // Fecha mesmo se não gerar notif
            }
        } else {
            // Para outras ações, apenas fecha o modal de acompanhamento
            closeModal(dom.followUpModal);
        }
        // A lista será atualizada automaticamente pelo listener onSnapshot

    } catch (error) {
        console.error("Erro ao salvar etapa:", error);
        showToast('Erro ao salvar a etapa.');
    }
}


/**
 * Lida com a edição de um fato (Ação 1).
 * (MODIFICADO - Plano 3a) Usa fetchIncidentById.
 */
async function handleEditOccurrence(groupId) {
    // (MODIFICADO - Plano 3a) Usa a função otimizada para buscar o incidente
    const incident = await fetchIncidentById(groupId);
    if (incident) {
        openOccurrenceModal(incident); // Abre o modal da Ação 1 com os dados carregados
    } else {
        showToast('Incidente não encontrado para edição.');
    }
}

/**
 * Lida com a confirmação para exclusão de um incidente.
 * (Inalterado - A lógica de exclusão em si está no main.js)
 */
function handleDelete(type, id) {
    document.getElementById('delete-confirm-message').textContent = 'Tem certeza que deseja excluir este incidente e todos os seus registros associados? Esta ação não pode ser desfeita.';
    state.recordToDelete = { type, id };
    openModal(dom.deleteConfirmModal);
}

// ==============================================================================
// --- Funções para o fluxo "Enviar ao CT" (Separado, se necessário no futuro) ---
// (Estas funções permanecem, caso decida reativar um botão dedicado)
// ==============================================================================

/**
 * Abre o modal para enviar ao CT (via botão principal, se necessário).
 * (MODIFICADO - Plano 3a) Usa fetchIncidentById.
 */
async function openSendOccurrenceCtModal(groupId) {
    const incident = await fetchIncidentById(groupId); // Usa a função otimizada
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

    // (MODIFICADO - Papéis) Usa participantsInvolved para listar alunos
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
        const [entry] = incident.participantsInvolved.entries(); // Pega a primeira entrada [id, {student, role}]
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
 * (Inalterado na lógica principal, mas depende do estado atualizado)
 */
async function handleSendOccurrenceCtSubmit(e) {
    e.preventDefault();
    const form = e.target;
    if (!form.checkValidity()) { form.reportValidity(); return showToast('Por favor, preencha o número do ofício.'); }

    // const groupId = document.getElementById('send-ct-group-id').value; // Não usado diretamente aqui
    const recordId = document.getElementById('send-ct-record-id').value;
    const studentId = document.getElementById('send-ct-student-id').value;
    const oficioNumber = document.getElementById('send-ct-oficio-number').value.trim();

    if (!recordId || !studentId) { return showToast('Erro: Aluno ou registro inválido. Selecione um aluno.'); }

    const record = state.occurrences.find(r => r.id === recordId);
    if (!record) return showToast("Erro: Registro não encontrado.");
    // A checagem de status é crucial. O envio só deve ocorrer se estiver aguardando desfecho.
    if (record.statusIndividual !== 'Aguardando Desfecho') {
        showToast(`Erro: O aluno deve estar no status 'Aguardando Desfecho'. Status atual: ${record.statusIndividual}`); return;
    }

    const oficioYear = new Date().getFullYear();
    const ctSentDate = new Date().toISOString().split('T')[0]; // Data atual

    const dataToUpdate = {
        oficioNumber, oficioYear, ctSentDate,
        statusIndividual: 'Aguardando Devolutiva CT', // Atualiza status
        desfechoChoice: 'ct' // Guarda a escolha
    };
    const historyAction = `Ação 4 (Encaminhamento ao CT) registrada via botão dedicado. Ofício: ${oficioNumber}/${oficioYear}.`;

    try {
        await updateRecordWithHistory('occurrence', recordId, dataToUpdate, historyAction, state.userEmail);
        showToast("Registro atualizado com sucesso!");
        closeModal(document.getElementById('send-occurrence-ct-modal'));

        // Busca os dados atualizados para gerar o ofício
        const student = state.students.find(s => s.matricula === studentId);
        // Cria um objeto 'record' atualizado EM MEMÓRIA para o ofício
        const updatedRecordForOficio = { ...record, ...dataToUpdate };

        if (updatedRecordForOficio && student) {
            generateAndShowOccurrenceOficio(updatedRecordForOficio, student, oficioNumber, oficioYear);
        } else {
             showToast("Dados atualizados, mas erro ao recarregar para gerar ofício.");
        }
        // A lista será atualizada pelo onSnapshot
    } catch (error) {
        console.error("Erro ao enviar ao CT:", error);
        showToast('Erro ao salvar os dados do envio ao CT.');
    }
}


/**
 * Lida com o clique no botão "Ver Ofício".
 * (MODIFICADO - Plano 3a) Usa fetchIncidentById.
 */
async function handleViewOccurrenceOficio(recordId) {
    if (!recordId) return;
    let targetRecord = null; let targetIncident = null;

    // Tenta encontrar o registro no estado atual
    const recordFromState = state.occurrences.find(r => r.id === recordId);
    if (!recordFromState || !recordFromState.occurrenceGroupId) {
         return showToast('Registro da ocorrência não encontrado ou sem ID de grupo.');
    }

    // Busca o incidente completo para garantir todos os dados
    targetIncident = await fetchIncidentById(recordFromState.occurrenceGroupId);
    if (!targetIncident) return showToast('Incidente associado não encontrado.');

    // Encontra o registro específico dentro do incidente buscado
    targetRecord = targetIncident.records.find(r => r.id === recordId);
    if (!targetRecord) return showToast('Registro não encontrado dentro do incidente.'); // Segurança extra

    if (!targetRecord.oficioNumber) return showToast('Este registro não possui um ofício associado.');

    // (MODIFICADO - Papéis) Pega o aluno da estrutura participantsInvolved
    const participantData = targetIncident.participantsInvolved.get(targetRecord.studentId);
    const student = participantData?.student;

    if (!student) return showToast('Aluno associado ao registro não encontrado.');
    generateAndShowOccurrenceOficio(targetRecord, student, targetRecord.oficioNumber, targetRecord.oficioYear);
}


/**
 * Lida com o clique no nome de um aluno para avançar a etapa.
 * (MODIFICADO - Plano 3a) Usa fetchIncidentById.
 */
async function handleNewOccurrenceAction(studentId, groupId, recordId) {
    const incident = await fetchIncidentById(groupId); // Usa a função otimizada
    if (!incident) return showToast('Erro: Incidente não encontrado.');

    // (MODIFICADO - Papéis) Pega o aluno da estrutura participantsInvolved
    const participantData = incident.participantsInvolved.get(studentId);
    const student = participantData?.student;
    if (!student) return showToast('Erro: Aluno não encontrado no incidente.');

    const record = incident.records.find(r => r.id === recordId);
    if (!record) return showToast('Erro: Registro individual não encontrado.');

    // Determina a PRÓXIMA ação com base no status ATUAL do registro
    const nextAction = determineNextOccurrenceStep(record.statusIndividual);

    if (nextAction === null) {
        showToast('Este processo individual já foi finalizado.');
        return;
    }
    // Abre o modal para a PRÓXIMA ação
    openOccurrenceStepModal(student, record, nextAction);
}

/**
 * Lida com o clique no botão "Notificação" ao lado do nome.
 * (MODIFICADO - Plano 3a) Usa fetchIncidentById.
 */
async function handleGenerateNotification(recordId, studentId, groupId) {
    const incident = await fetchIncidentById(groupId); // Usa a função otimizada
     if (!incident) return showToast('Erro: Incidente não encontrado.');

    // (MODIFICADO - Papéis) Pega o aluno da estrutura participantsInvolved
    const participantData = incident.participantsInvolved.get(studentId);
    const student = participantData?.student;
    if (!student) return showToast('Erro: Aluno não encontrado.');

    // A função openIndividualNotificationModal já busca o record pelo studentId dentro do incident
    // e verifica se a Ação 2 foi preenchida.
    openIndividualNotificationModal(incident, student);
}


// --- Função Principal de Inicialização ---

/**
 * Anexa todos os listeners de eventos relacionados a Ocorrências.
 * (MODIFICADO - Papéis) Adiciona listeners para edição de papel.
 * (MODIFICADO - Plano 3b) Adiciona listener para rádios de desfecho.
 */
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

    // Formulários
    dom.occurrenceForm.addEventListener('submit', handleOccurrenceSubmit);
    dom.followUpForm.addEventListener('submit', handleOccurrenceStepSubmit);
    const sendCtForm = document.getElementById('send-occurrence-ct-form');
    if (sendCtForm) sendCtForm.addEventListener('submit', handleSendOccurrenceCtSubmit);

    // Listener de Clique Delegado para a Lista de Ocorrências
    dom.occurrencesListDiv.addEventListener('click', (e) => {
        const button = e.target.closest('button');
        if (!button) return;

        // Clicar no nome/ícone do aluno para avançar etapa
        const followUpTrigger = e.target.closest('.student-follow-up-trigger');
        if (followUpTrigger && !followUpTrigger.disabled) { // Verifica se não está desabilitado
            e.stopPropagation();
            const groupId = followUpTrigger.dataset.groupId;
            const studentId = followUpTrigger.dataset.studentId;
            const recordId = followUpTrigger.dataset.recordId;
            handleNewOccurrenceAction(studentId, groupId, recordId);
            return;
        }

        // Botão Kebab Menu
        if (button.classList.contains('kebab-menu-btn')) {
            e.stopPropagation();
            const dropdown = button.nextElementSibling;
            if (dropdown) {
                // Fecha outros menus abertos
                document.querySelectorAll('.kebab-menu-dropdown').forEach(d => { if (d !== dropdown) d.classList.add('hidden'); });
                dropdown.classList.toggle('hidden');
            }
            return;
        }

        // Botão Ver Ofício
        if (button.classList.contains('view-occurrence-oficio-btn')) {
             e.stopPropagation();
             const recordId = button.dataset.recordId;
             handleViewOccurrenceOficio(recordId);
             return;
        }

        // Botão Notificação ao lado do nome
        if (button.classList.contains('notification-student-btn')) {
             e.stopPropagation();
             const recordId = button.dataset.recordId;
             const studentId = button.dataset.studentId;
             const groupId = button.dataset.groupId;
             handleGenerateNotification(recordId, studentId, groupId);
             return;
        }

        const groupId = button.dataset.groupId;
        if (!groupId) return; // Se não tem groupId, não continua

        e.stopPropagation(); // Impede outros cliques

        // Botão Gerar Ata
        if (button.classList.contains('record-btn')) {
            openOccurrenceRecordModal(groupId);
        // Botões dentro do Kebab ou movidos para fora (Editar Fato)
        } else if (button.classList.contains('kebab-action-btn')) {
            const action = button.dataset.action;
            if (action === 'edit' && !button.disabled) handleEditOccurrence(groupId); // Verifica disabled
            else if (action === 'delete' && !button.disabled) handleDelete('occurrence', groupId); // Verifica disabled
            else if (action === 'history') openHistoryModal(groupId);

            // Fecha o dropdown se for uma ação do kebab
            const dropdown = button.closest('.kebab-menu-dropdown');
            if(dropdown) dropdown.classList.add('hidden');
        }
    });

    // Listener para Rádios de Contato (Ação 3)
    document.querySelectorAll('input[name="follow-up-contact-succeeded"]').forEach(radio =>
        radio.addEventListener('change', (e) => {
            toggleOccurrenceContactFields(e.target.value === 'yes');
        })
    );

    // (NOVO - Plano 3b) Listener para Rádios de Desfecho (Ação 4/6)
    document.querySelectorAll('input[name="follow-up-desfecho-choice"]').forEach(radio =>
        radio.addEventListener('change', (e) => {
            toggleDesfechoFields(e.target.value);
        })
    );

    // Fechar Modal "Enviar ao CT" (se usado)
    const closeSendCtBtn = document.getElementById('close-send-ct-modal-btn');
    const cancelSendCtBtn = document.getElementById('cancel-send-ct-modal-btn');
    const sendCtModal = document.getElementById('send-occurrence-ct-modal');
    if (closeSendCtBtn && sendCtModal) closeSendCtBtn.onclick = () => closeModal(sendCtModal);
    if (cancelSendCtBtn && sendCtModal) cancelSendCtBtn.onclick = () => closeModal(sendCtModal);

     // (NOVO - Papéis) Listener para fechar dropdown de edição de papel (caso clique fora)
     // A lógica principal de fechar já está no `openRoleEditDropdown`, mas adicionamos
     // um listener global extra por segurança.
     document.addEventListener('click', (e) => {
        const dropdown = document.getElementById('role-edit-dropdown');
        const isEditButton = e.target.closest('.edit-role-btn');
        if (!dropdown.classList.contains('hidden') && !dropdown.contains(e.target) && !isEditButton) {
            dropdown.classList.add('hidden');
            editingRoleId = null;
        }
    });
};
