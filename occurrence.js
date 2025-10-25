// =================================================================================
// ARQUIVO: occurrence.js (REFATORADO PARA FLUXO V3)
// RESPONSABILIDADE: Gerenciar a lógica, UI e eventos da
// funcionalidade "Ocorrências" com o novo fluxo de 6 etapas.
//
// ATUALIZAÇÃO (FLUXO V3):
// 1. (Ação 1) `handleOccurrenceSubmit` modificado para salvar um registro
//    individual por aluno com status 'Aguardando Convocação' e
//    inicializar todos os campos de etapas futuras como nulos.
// 2. (Ação 1) `openOccurrenceModal` simplificado para coletar apenas
//    os dados do "Fato" (incluindo "Providências da Escola").
// 3. (Ações 2-6) `openFollowUpModal` e `handleFollowUpSubmit` REMOVIDOS.
// 4. (Ações 2-6) Adicionadas novas funções `handleOccurrenceStepClick`,
//    `determineNextOccurrenceStep`, `openOccurrenceStepModal`, e
//    `handleOccurrenceStepSubmit` para gerenciar o novo modal dinâmico,
//    similar ao `absence.js`.
// 5. (Ações 2-6) `initOccurrenceListeners` atualizado para usar os novos
//    handlers de clique e submissão.
// 6. Lógica de "Enviar ao CT" (V2) foi REMOVIDA e integrada como "Ação 4".
// 7. `renderOccurrences` mantido (exibição por incidente), mas os cliques
//    nos alunos agora disparam o novo fluxo de etapas.
// =================================================================================

import { state, dom } from './state.js';
import { showToast, openModal, closeModal, getStatusBadge, formatDate, formatTime } from './utils.js';
import { getCollectionRef, getCounterDocRef, updateRecordWithHistory, addRecordWithHistory, deleteRecord } from './firestore.js';
// generateAndShowOccurrenceOficio ainda é necessário para a Ação 4
import { openStudentSelectionModal, openOccurrenceRecordModal, openHistoryModal, generateAndShowGeneralReport, generateAndShowOccurrenceOficio } from './reports.js';
import { writeBatch, doc, collection, query, where, getDocs, runTransaction } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db } from './firebase.js';

// --- (NOVO) Helpers de Lógica de Processo ---

// Mapeia o STATUS ATUAL para a PRÓXIMA AÇÃO (Ação 2-6)
const nextActionMap = {
    'Aguardando Convocação': 'convocacao', // Ação 2
    'Aguardando Contato': 'contato_familia', // Ação 3
    'Aguardando Desfecho': 'parecer_final', // Ação 6 (Padrão)
    'Aguardando Devolutiva CT': 'devolutiva_ct', // Ação 5
    'Aguardando Parecer Final': 'parecer_final', // Ação 6
    'Resolvido': null // Processo finalizado
};

// Mapeia a AÇÃO ATUAL para o PRÓXIMO STATUS
const nextStatusMap = {
    'registro_fato': 'Aguardando Convocação',
    'convocacao': 'Aguardando Contato',
    'contato_familia_sim': 'Aguardando Desfecho', // Se "Conseguiu contato?" = Sim
    'contato_familia_nao': 'Aguardando Contato', // Se "Conseguiu contato?" = Não
    'encaminhamento_ct': 'Aguardando Devolutiva CT',
    'devolutiva_ct': 'Aguardando Parecer Final',
    'parecer_final': 'Resolvido'
};

// Títulos para o modal dinâmico
const occurrenceActionTitles = {
    'convocacao': 'Ação 2: Agendar Convocação',
    'contato_familia': 'Ação 3: Registrar Contato com Família',
    'encaminhamento_ct': 'Ação 4: Encaminhar ao Conselho Tutelar (Opcional)',
    'devolutiva_ct': 'Ação 5: Registrar Devolutiva do CT',
    'parecer_final': 'Ação 6: Parecer Final / Desfecho'
};

// --- Funções de UI (Seleção de Aluno) ---

/**
 * Gerencia a UI de seleção de múltiplos alunos (usado pela Ação 1).
 * (Inalterado)
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

// --- Funções de UI (Renderização da Lista) ---

/**
 * Filtra e agrupa ocorrências por Incidente (occurrenceGroupId).
 * (Lógica de status atualizada para V3)
 */
export const getFilteredOccurrences = () => {
    const groupedByIncident = state.occurrences.reduce((acc, occ) => {
        const groupId = occ.occurrenceGroupId || `individual-${occ.id}`;
        if (!acc.has(groupId)) {
            acc.set(groupId, { id: groupId, records: [], studentsInvolved: new Map() });
        }
        const incident = acc.get(groupId);
        incident.records.push(occ);
        const student = state.students.find(s => s.matricula === occ.studentId);
        if (student) {
            incident.studentsInvolved.set(student.matricula, student);
        }
        return acc;
    }, new Map());

    const filteredIncidents = new Map();
    for (const [groupId, incident] of groupedByIncident.entries()) {
        const mainRecord = incident.records[0];
        if (!mainRecord) continue;
        
        const { startDate, endDate, status, type } = state.filtersOccurrences;
        const studentSearch = state.filterOccurrences.toLowerCase();

        // ATUALIZADO V3: Status "Finalizada" significa que TODOS os alunos estão "Resolvido"
        const allResolved = incident.records.every(r => r.statusIndividual === 'Resolvido');
        const overallStatus = allResolved ? 'Finalizada' : 'Pendente';
        incident.overallStatus = overallStatus;

        if (startDate && mainRecord.date < startDate) continue;
        if (endDate && mainRecord.date > endDate) continue;
        if (status !== 'all' && overallStatus !== status) continue;
        if (type !== 'all' && mainRecord.occurrenceType !== type) continue;
        
        if (studentSearch) {
            const hasMatchingStudent = [...incident.studentsInvolved.values()].some(s => 
                s.name.toLowerCase().includes(studentSearch)
            );
            if (!hasMatchingStudent) continue;
        }
        filteredIncidents.set(groupId, incident);
    }
    return filteredIncidents;
};

/**
 * Renderiza a lista de ocorrências (Agrupadas por Incidente).
 * (Botão "Enviar ao CT" e "Ver Ofício" removidos - agora são etapas)
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
        new Date(b.records[0].date) - new Date(a.records[0].date)
    );

    let html = sortedIncidents.map(incident => {
        const mainRecord = incident.records[0];
        const studentSearch = state.filterOccurrences.toLowerCase();

        const studentDetailsHTML = [...incident.studentsInvolved.values()].map(student => {
            const record = incident.records.find(r => r.studentId === student.matricula);
            // ATUALIZADO V3: Usa o status individual real
            const status = record?.statusIndividual || 'Aguardando Convocação'; 
            const isMatch = studentSearch && student.name.toLowerCase().includes(studentSearch);
            const nameClass = isMatch ? 'font-bold text-yellow-800' : 'font-medium text-gray-700';
            let borderClass = isMatch ? 'border-yellow-300 bg-yellow-50' : 'border-gray-200 bg-gray-50';
            let hoverClass = isMatch ? 'hover:bg-yellow-100' : 'hover:bg-indigo-50';

            // REMOVIDO V3: Botão "Ver Ofício" (agora é uma etapa)

            return `
                <div class="flex items-center gap-1.5 py-1 px-2 rounded-lg border ${borderClass} ${hoverClass} transition-colors">
                    <button type="button" 
                            class="student-follow-up-trigger flex items-center gap-1"
                            data-group-id="${incident.id}"
                            data-student-id="${student.matricula}"
                            title="Avançar etapa de ${student.name}">
                        <span class="${nameClass}">${student.name}</span>
                        ${getStatusBadge(status)}
                    </button>
                </div>`;
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
                        
                        <!-- REMOVIDO V3: Botão "Enviar ao CT" (agora é uma etapa) -->
                        
                        <div class="relative kebab-menu-container self-center">
                            <button class="kebab-menu-btn text-gray-500 hover:text-gray-800 p-2 rounded-full hover:bg-gray-100" data-group-id="${incident.id}" title="Mais Opções">
                                <i class="fas fa-ellipsis-v"></i>
                            </button>
                            <div class="kebab-menu-dropdown hidden absolute right-0 mt-1 w-48 bg-white rounded-md shadow-lg border z-10">
                                <!-- ATUALIZADO V3: Botão de Acompanhamento agora é "Próxima Etapa" -->
                                <button class="kebab-action-btn menu-item w-full text-left" data-action="follow-up" data-group-id="${incident.id}"><i class="fas fa-shoe-prints mr-2 w-4"></i>Avançar Etapa</button>
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

// --- Funções de Handler (Ação 1: Registro do Fato) ---

/**
 * Abre o modal para registrar ou editar os dados COLETIVOS (Ação 1).
 * (MODIFICADO V3: Simplificado para conter apenas os campos da Ação 1)
 */
export const openOccurrenceModal = (incidentToEdit = null) => {
    dom.occurrenceForm.reset();
    state.selectedStudents.clear();

    if (incidentToEdit) {
        // Modo Edição (Ação 1)
        const mainRecord = incidentToEdit.records[0];
        document.getElementById('modal-title').innerText = 'Editar Fato da Ocorrência';
        document.getElementById('occurrence-group-id').value = incidentToEdit.id;
        incidentToEdit.studentsInvolved.forEach((student, studentId) => {
            state.selectedStudents.set(studentId, student);
        });
        document.getElementById('occurrence-type').value = mainRecord.occurrenceType || '';
        document.getElementById('occurrence-date').value = mainRecord.date || '';
        document.getElementById('description').value = mainRecord.description || '';
        // (NOVO V3) Preenche o novo campo
        document.getElementById('providencias-escola').value = mainRecord.providenciasEscola || '';

    } else {
        // Modo Criação (Ação 1)
        document.getElementById('modal-title').innerText = 'Registar Nova Ocorrência (Ação 1: Fato)';
        document.getElementById('occurrence-group-id').value = '';
        document.getElementById('occurrence-date').valueAsDate = new Date();
        document.getElementById('providencias-escola').value = ''; // Garante que está limpo
    }

    const studentInput = document.getElementById('student-search-input');
    const suggestionsDiv = document.getElementById('student-suggestions');
    const tagsContainer = document.getElementById('student-tags-container');
    setupStudentTagInput(studentInput, suggestionsDiv, tagsContainer);
    openModal(dom.occurrenceModal);
};

/**
 * Lida com a submissão do formulário de ocorrências (Ação 1).
 * (MODIFICADO V3: Cria registros individuais por aluno com status inicial)
 */
async function handleOccurrenceSubmit(e) {
    e.preventDefault();
    const groupId = document.getElementById('occurrence-group-id').value;
    if (state.selectedStudents.size === 0) return showToast("Selecione pelo menos um aluno.");

    // (MODIFICADO V3) Coleta apenas dados da Ação 1
    const collectiveData = {
        date: document.getElementById('occurrence-date').value,
        occurrenceType: document.getElementById('occurrence-type').value,
        description: document.getElementById('description').value.trim(),
        providenciasEscola: document.getElementById('providencias-escola').value.trim(), // (NOVO V3)
    };

    // (NOVO V3) Define a estrutura de dados inicial para todas as etapas
    const initialStepFields = {
        statusIndividual: nextStatusMap['registro_fato'], // 'Aguardando Convocação'
        // Ação 2
        meetingDate: null,
        meetingTime: null,
        // Ação 3
        contactSucceeded: null,
        contactType: null,
        contactDate: null,
        providenciasFamilia: null,
        // Ação 4
        oficioNumber: null,
        oficioYear: null,
        ctSentDate: null,
        // Ação 5
        ctFeedback: null,
        // Ação 6
        parecerFinal: null,
    };

    try {
        if (groupId) {
            // --- MODO DE EDIÇÃO DO FATO (Ação 1) ---
            const originalIncident = getFilteredOccurrences().get(groupId); // Recarrega o incidente
            if (!originalIncident) throw new Error("Incidente original não encontrado.");

            const historyAction = "Dados gerais do fato (Ação 1) foram atualizados.";
            const batch = writeBatch(db);
            const studentIdsInvolved = [...state.selectedStudents.keys()];

            // Atualiza alunos existentes
            originalIncident.records.forEach(record => {
                if (studentIdsInvolved.includes(record.studentId)) {
                    const recordRef = doc(getCollectionRef('occurrence'), record.id);
                    batch.update(recordRef, collectiveData); // Atualiza apenas os dados coletivos
                }
            });

            // Adiciona novos alunos (se houver)
            for (const studentId of studentIdsInvolved) {
                const isNewStudent = !originalIncident.records.some(r => r.studentId === studentId);
                if (isNewStudent) {
                    const newRecordRef = doc(collection(db, getCollectionRef('occurrence').path));
                    const newRecordData = { 
                        ...collectiveData, 
                        ...initialStepFields, // Adiciona todos os campos nulos
                        studentId, 
                        occurrenceGroupId: groupId, 
                        createdAt: new Date(), 
                        createdBy: state.userEmail 
                    };
                    batch.set(newRecordRef, newRecordData);
                }
            }

            // Remove alunos (se houver)
            const removedStudentIds = originalIncident.records.map(r => r.studentId).filter(id => !studentIdsInvolved.includes(id));
            for (const studentId of removedStudentIds) {
                const recordToDelete = originalIncident.records.find(r => r.studentId === studentId);
                if (recordToDelete) batch.delete(doc(getCollectionRef('occurrence'), recordToDelete.id));
            }

            // Adiciona histórico para todos os registros afetados (existentes)
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
            // --- MODO DE CRIAÇÃO (Ação 1) ---
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
                    ...initialStepFields, // Adiciona a estrutura completa
                    studentId, 
                    occurrenceGroupId: newGroupId 
                };
                // Salva o registro individual
                await addRecordWithHistory('occurrence', recordData, 'Ação 1: Registro do Fato', state.userEmail);
            }
            showToast(`Ocorrência ${newGroupId} registrada para ${state.selectedStudents.size} aluno(s)!`);
        }
        closeModal(dom.occurrenceModal);
    } catch (error) {
        console.error("Erro ao salvar ocorrência (Ação 1):", error);
        showToast('Erro ao salvar a ocorrência.');
    }
}


// --- (NOVO V3) Funções de Handler (Ações 2-6: Etapas Individuais) ---

/**
 * Determina qual é a próxima ação com base no status individual do aluno.
 */
function determineNextOccurrenceStep(studentRecord) {
    if (!studentRecord) return null;
    const currentStatus = studentRecord.statusIndividual;
    
    // Se o status for "Aguardando Desfecho", permite "Encaminhamento ao CT" (Ação 4) ou "Parecer Final" (Ação 6)
    if (currentStatus === 'Aguardando Desfecho') {
        // O modal dinâmico (openOccurrenceStepModal) lidará com a exibição de ambos os botões
        return 'desfecho_ou_ct'; // Um tipo especial para o modal
    }
    
    return nextActionMap[currentStatus] || null;
}

/**
 * Ponto de entrada para o acompanhamento individual (clique no nome do aluno).
 */
export function handleOccurrenceStepClick(studentId, groupId) {
    if (!studentId || !groupId) return showToast("Erro: ID do aluno ou grupo não encontrado.");

    const incident = getFilteredOccurrences().get(groupId);
    const record = incident?.records.find(r => r.studentId === studentId);
    const student = incident?.studentsInvolved.get(studentId);

    if (!record || !student) return showToast("Erro: Registro individual do aluno não encontrado.");

    const nextAction = determineNextOccurrenceStep(record);

    if (nextAction === null) {
        showToast("Este processo já foi finalizado (Resolvido).");
        // Abrir o modal em modo "somente leitura"
        openOccurrenceStepModal(student, record, 'parecer_final', true);
        return;
    }
    
    // Abre o modal dinâmico para a próxima etapa
    openOccurrenceStepModal(student, record, nextAction, false);
}

/**
 * Abre o modal de Acompanhamento dinâmico (follow-up-modal).
 * (Substitui o antigo openFollowUpModal)
 */
export const openOccurrenceStepModal = (student, record, actionType, isReadOnly = false) => {
    const modal = dom.followUpModal;
    const form = dom.followUpForm;
    if (!modal || !form) return showToast("Erro: Modal de acompanhamento não encontrado.");
    
    form.reset();
    form.dataset.recordId = record.id;
    form.dataset.studentId = record.studentId;
    form.dataset.actionType = actionType; // Salva a ação que está sendo executada

    // Preenche dados do aluno
    document.getElementById('follow-up-student-name').value = student.name;
    const statusDisplay = document.getElementById('follow-up-status-display');
    if (statusDisplay) {
        statusDisplay.innerHTML = `<strong>Status:</strong> ${getStatusBadge(record.statusIndividual)}`;
    }

    // Esconde todos os grupos de campos dinâmicos
    const fieldGroups = modal.querySelectorAll('.dynamic-occurrence-field-group');
    fieldGroups.forEach(group => group.classList.add('hidden'));

    // Reseta todos os campos para não-obrigatórios
    form.querySelectorAll('input, textarea, select').forEach(el => el.required = false);

    let title = "Acompanhamento Individual";
    let currentAction = actionType;

    // Lógica especial para Ação 4 vs Ação 6
    if (actionType === 'desfecho_ou_ct') {
        title = "Ação 4 ou 6: Encaminhar ao CT ou Dar Parecer Final";
        // Mostra *ambos* os grupos
        const groupCt = document.getElementById('group-encaminhamento-ct');
        const groupParecer = document.getElementById('group-parecer-final');
        if (groupCt) groupCt.classList.remove('hidden');
        if (groupParecer) groupParecer.classList.remove('hidden');
        
        // O usuário decidirá qual caminho seguir (o submit lidará com isso)
        // Nenhum campo é obrigatório aqui até que ele escolha
        currentAction = null; // Reseta para evitar preenchimento
    } else {
        // Mostra o grupo de campos para a ação atual
        const groupToShow = document.getElementById(`group-${actionType}`);
        if (groupToShow) {
            groupToShow.classList.remove('hidden');
            title = occurrenceActionTitles[actionType] || title;
            // Torna os campos deste grupo obrigatórios
            groupToShow.querySelectorAll('input, textarea, select').forEach(el => {
                if (!el.classList.contains('optional')) el.required = true;
            });
        }
    }
    
    // Define o título do modal
    const modalTitle = document.getElementById('follow-up-modal-title');
    if (modalTitle) modalTitle.innerText = title;

    // Preenche os dados existentes (de qualquer etapa)
    // Ação 2
    document.getElementById('follow-up-meeting-date').value = record.meetingDate || '';
    document.getElementById('follow-up-meeting-time').value = record.meetingTime || '';
    // Ação 3
    const contactRadio = document.querySelector(`input[name="follow-up-contact-succeeded"][value="${record.contactSucceeded}"]`);
    if (contactRadio) contactRadio.checked = true;
    document.getElementById('follow-up-contact-type').value = record.contactType || '';
    document.getElementById('follow-up-contact-date').value = record.contactDate || '';
    document.getElementById('follow-up-family-actions').value = record.providenciasFamilia || ''; // Providências da Família
    // Ação 4
    document.getElementById('follow-up-oficio-number').value = record.oficioNumber || '';
    document.getElementById('follow-up-oficio-date').value = record.ctSentDate || '';
    // Ação 5
    document.getElementById('follow-up-ct-feedback').value = record.ctFeedback || '';
    // Ação 6
    document.getElementById('follow-up-parecer').value = record.parecerFinal || '';

    // Lida com o estado read-only
    const submitButton = form.querySelector('button[type="submit"]');
    if (isReadOnly) {
        form.querySelectorAll('input, textarea, select, button[type="submit"]').forEach(el => el.disabled = true);
        if (submitButton) submitButton.classList.add('hidden');
        if (modalTitle) modalTitle.innerText = "Ver Processo Finalizado";
    } else {
         form.querySelectorAll('input, textarea, select, button[type="submit"]').forEach(el => el.disabled = false);
        if (submitButton) submitButton.classList.remove('hidden');
    }

    // Dispara o evento de "change" no rádio de contato para mostrar/esconder campos
    const contactSucceededRadioChecked = document.querySelector('input[name="follow-up-contact-succeeded"]:checked');
    if (contactSucceededRadioChecked) {
        contactSucceededRadioChecked.dispatchEvent(new Event('change'));
    } else {
        // Garante que se 'Não' ou 'null' estiver marcado, os campos fiquem escondidos
         document.getElementById('follow-up-family-contact-fields').classList.add('hidden');
    }

    openModal(modal);
};


/**
 * Lida com a submissão do formulário de Acompanhamento (Ações 2-6).
 * (Substitui o antigo handleFollowUpSubmit)
 */
async function handleOccurrenceStepSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const recordId = form.dataset.recordId;
    if (!recordId) return showToast("Erro: ID do registro não encontrado.");

    // Pega a ação que o modal foi aberto para executar
    let actionType = form.dataset.actionType;
    let dataToUpdate = {};
    let historyAction = "";
    let nextStatus = "";

    // Lógica especial para Ação 4 vs Ação 6
    if (actionType === 'desfecho_ou_ct') {
        const oficioNumber = document.getElementById('follow-up-oficio-number').value.trim();
        const oficioDate = document.getElementById('follow-up-oficio-date').value;
        const parecerFinal = document.getElementById('follow-up-parecer').value.trim();

        if (oficioNumber && oficioDate) {
            // Usuário escolheu Ação 4: Encaminhamento ao CT
            actionType = 'encaminhamento_ct';
            dataToUpdate = {
                oficioNumber: oficioNumber,
                ctSentDate: oficioDate,
                oficioYear: new Date(oficioDate).getFullYear()
            };
            historyAction = `Ação 4: Encaminhado ao CT (Ofício ${oficioNumber})`;
            nextStatus = nextStatusMap[actionType]; // 'Aguardando Devolutiva CT'

            // (Opcional) Gerar o ofício
            const record = state.occurrences.find(r => r.id === recordId);
            const student = state.students.find(s => s.matricula === record.studentId);
            if(record && student) {
                // Atualiza os dados locais para gerar o ofício
                record.oficioNumber = dataToUpdate.oficioNumber;
                record.ctSentDate = dataToUpdate.ctSentDate;
                record.oficioYear = dataToUpdate.oficioYear;
                generateAndShowOccurrenceOficio(record, student, dataToUpdate.oficioNumber, dataToUpdate.oficioYear);
            }
            
        } else if (parecerFinal) {
            // Usuário escolheu Ação 6: Parecer Final
            actionType = 'parecer_final';
            dataToUpdate = { parecerFinal: parecerFinal };
            historyAction = "Ação 6: Parecer Final registrado.";
            nextStatus = nextStatusMap[actionType]; // 'Resolvido'
        } else {
            return showToast("Preencha os campos de 'Encaminhamento ao CT' ou o 'Parecer Final' para continuar.");
        }
    } else {
        // Lógica para as outras etapas (2, 3, 5)
        switch (actionType) {
            case 'convocacao': // Ação 2
                dataToUpdate = {
                    meetingDate: document.getElementById('follow-up-meeting-date').value,
                    meetingTime: document.getElementById('follow-up-meeting-time').value,
                };
                historyAction = `Ação 2: Convocação agendada para ${formatDate(dataToUpdate.meetingDate)}.`;
                nextStatus = nextStatusMap[actionType]; // 'Aguardando Contato'
                break;

            case 'contato_familia': // Ação 3
                const contactSucceededRadio = document.querySelector('input[name="follow-up-contact-succeeded"]:checked');
                const contactSucceeded = contactSucceededRadio ? contactSucceededRadio.value : null;
                
                if (!contactSucceeded) return showToast("Responda: 'Conseguiu contato?'");

                if (contactSucceeded === 'yes') {
                    dataToUpdate = {
                        contactSucceeded: 'yes',
                        contactType: document.getElementById('follow-up-contact-type').value,
                        contactDate: document.getElementById('follow-up-contact-date').value,
                        providenciasFamilia: document.getElementById('follow-up-family-actions').value.trim(),
                    };
                    historyAction = "Ação 3: Contato com família realizado (Sim).";
                    nextStatus = nextStatusMap['contato_familia_sim']; // 'Aguardando Desfecho'
                } else {
                    dataToUpdate = { contactSucceeded: 'no' };
                    historyAction = "Ação 3: Tentativa de contato sem sucesso (Não).";
                    nextStatus = nextStatusMap['contato_familia_nao']; // 'Aguardando Contato' (volta)
                }
                break;

            case 'devolutiva_ct': // Ação 5
                dataToUpdate = {
                    ctFeedback: document.getElementById('follow-up-ct-feedback').value.trim(),
                };
                historyAction = "Ação 5: Devolutiva do CT registrada.";
                nextStatus = nextStatusMap[actionType]; // 'Aguardando Parecer Final'
                break;

            case 'parecer_final': // Ação 6 (quando vindo direto)
                dataToUpdate = {
                    parecerFinal: document.getElementById('follow-up-parecer').value.trim(),
                };
                historyAction = "Ação 6: Parecer Final registrado.";
                nextStatus = nextStatusMap[actionType]; // 'Resolvido'
                break;
                
            default:
                return showToast("Erro: Ação desconhecida.");
        }
    }

    // Adiciona o novo status ao objeto de atualização
    dataToUpdate.statusIndividual = nextStatus;

    try {
        await updateRecordWithHistory('occurrence', recordId, dataToUpdate, historyAction, state.userEmail);
        showToast("Etapa salva com sucesso!");
        closeModal(dom.followUpModal);
    } catch (error) {
        console.error("Erro ao salvar etapa da ocorrência:", error);
        showToast('Erro ao salvar a etapa.');
    }
}


// --- Handlers de Ações (Kebab e Botões) ---

/**
 * Lida com a edição de um fato (helper).
 * (Inalterado - ainda abre o modal da Ação 1)
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
 * (Inalterado)
 */
function handleDelete(type, id) {
    document.getElementById('delete-confirm-message').textContent = 'Tem certeza que deseja excluir este incidente e todos os seus registros? Esta ação não pode ser desfeita.';
    state.recordToDelete = { type, id };
    openModal(dom.deleteConfirmModal);
}

// --- (REMOVIDO V3) Funções de Envio ao CT (V2) ---
// `openSendOccurrenceCtModal` (REMOVIDO)
// `handleSendOccurrenceCtSubmit` (REMOVIDO)
// `handleViewOccurrenceOficio` (REMOVIDO)
// A funcionalidade agora está na Ação 4.


// --- Função Principal de Inicialização ---

/**
 * Anexa todos os listeners de eventos relacionados a Ocorrências.
 * (MODIFICADO V3: Atualizado para o novo fluxo de etapas)
 */
export const initOccurrenceListeners = () => {
    // Botão "Nova Ocorrência" (Ação 1)
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
    dom.occurrenceForm.addEventListener('submit', handleOccurrenceSubmit); // Salva Ação 1
    dom.followUpForm.addEventListener('submit', handleOccurrenceStepSubmit); // Salva Ações 2-6

    // Listener de clique para a lista (delegação de eventos)
    dom.occurrencesListDiv.addEventListener('click', (e) => {
        const button = e.target.closest('button');
        if (!button) return;

        // (MODIFICADO V3) Clique no aluno para avançar etapa
        const followUpTrigger = e.target.closest('.student-follow-up-trigger');
        if (followUpTrigger) {
            e.stopPropagation();
            const groupId = followUpTrigger.dataset.groupId;
            const studentId = followUpTrigger.dataset.studentId;
            handleOccurrenceStepClick(studentId, groupId); // Chama o novo handler
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

        // (REMOVIDO V3) Listeners de 'view-occurrence-oficio-btn' e 'send-occurrence-ct-btn'

        const groupId = button.dataset.groupId;
        if (!groupId) return; // Proteção
        e.stopPropagation();

        if (button.classList.contains('notification-btn')) {
            openStudentSelectionModal(groupId);
        } else if (button.classList.contains('record-btn')) {
            openOccurrenceRecordModal(groupId);
        } else if (button.classList.contains('kebab-action-btn')) {
            const action = button.dataset.action;
            
            if (action === 'follow-up') {
                // (MODIFICADO V3) Kebab "Avançar Etapa"
                // Precisa saber *qual* aluno. Abre o modal de seleção.
                // O `follow-up-modal` (dinâmico) agora tem o seletor de aluno.
                // Reutilizando a função `openOccurrenceStepModal` sem `actionType`
                // fará com que ela determine a ação baseada no aluno selecionado.
                
                // Esta é a função antiga, que mostra o seletor de aluno
                // Vamos adaptá-la para o V3
                openFollowUpModalV3_Selector(groupId); 
            }
            else if (action === 'edit') handleEditOccurrence(groupId);
            else if (action === 'history') openHistoryModal(groupId);
            else if (action === 'delete') handleDelete('occurrence', groupId); 
            
            const dropdown = button.closest('.kebab-menu-dropdown');
            if(dropdown) dropdown.classList.add('hidden'); // Fecha o menu kebab
        }
    });

    // (NOVO V3) Listener para o rádio "Conseguiu contato?" no modal dinâmico
    document.querySelectorAll('input[name="follow-up-contact-succeeded"]').forEach(radio =>
        radio.addEventListener('change', (e) => {
            const enable = e.target.value === 'yes';
            const contactFieldsContainer = document.getElementById('follow-up-family-contact-fields');
            if(contactFieldsContainer) contactFieldsContainer.classList.toggle('hidden', !enable);
            
            // Torna campos obrigatórios apenas se "Sim"
            contactFieldsContainer.querySelectorAll('select, input, textarea').forEach(el => {
                el.required = enable;
            });
        })
    );

    // (REMOVIDO V3) Listeners do modal 'send-occurrence-ct-modal'
};


/**
 * (NOVO V3) Função auxiliar para o botão "Avançar Etapa" do Kebab.
 * Abre o modal dinâmico e mostra o seletor de aluno.
 */
function openFollowUpModalV3_Selector(groupId) {
    const incident = getFilteredOccurrences().get(groupId);
    if (!incident) return showToast('Erro: Incidente não encontrado.');

    const modal = dom.followUpModal;
    const form = dom.followUpForm;
    form.reset(); // Limpa o formulário
    
    // Esconde todos os grupos de campos dinâmicos
    modal.querySelectorAll('.dynamic-occurrence-field-group').forEach(group => group.classList.add('hidden'));

    // Mostra o seletor de aluno e limpa o form
    const studentSelect = document.getElementById('follow-up-student-select');
    const studentSelectWrapper = studentSelect.parentElement;
    studentSelectWrapper.classList.remove('hidden');
    
    // Oculta o formulário de acompanhamento até que um aluno seja selecionado
    document.getElementById('follow-up-form-content').classList.add('hidden');
    const modalTitle = document.getElementById('follow-up-modal-title');
    if (modalTitle) modalTitle.innerText = "Selecione o Aluno";
    
    studentSelect.innerHTML = '<option value="">Selecione um aluno...</option>';

    // Popula o seletor
    incident.studentsInvolved.forEach((student, studentId) => {
        const record = incident.records.find(r => r.studentId === studentId);
        if (record) {
            const option = document.createElement('option');
            option.value = studentId; // Usa studentId
            option.textContent = `${student.name} (${record.statusIndividual || 'N/A'})`;
            option.dataset.groupId = groupId;
            studentSelect.appendChild(option);
        }
    });

    // Define o handler do 'change'
    studentSelect.onchange = (e) => {
        const studentId = e.target.value;
        if (!studentId) {
            document.getElementById('follow-up-form-content').classList.add('hidden');
            return;
        }
        
        // Mostra o conteúdo do formulário
        document.getElementById('follow-up-form-content').classList.remove('hidden');
        
        // Encontra o registro e aluno
        const record = incident.records.find(r => r.studentId === studentId);
        const student = incident.studentsInvolved.get(studentId);
        
        if (!record || !student) {
            closeModal(modal);
            return showToast("Erro ao carregar dados do aluno.");
        }
        
        // Determina a próxima ação
        const nextAction = determineNextOccurrenceStep(record);
        
        if (nextAction === null) {
            // Processo finalizado, abre em modo leitura
            openOccurrenceStepModal(student, record, 'parecer_final', true);
        } else {
            // Abre o modal para a etapa correta
            openOccurrenceStepModal(student, record, nextAction, false);
        }
        
        // Esconde o seletor de aluno DEPOIS de carregar o modal
        studentSelectWrapper.classList.add('hidden');
    };
    
    openModal(modal);
}
