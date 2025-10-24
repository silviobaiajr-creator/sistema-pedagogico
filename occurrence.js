// =================================================================================
// ARQUIVO: occurrence.js (NOVO)
// RESPONSABILIDADE: Gerenciar toda a lógica, UI e eventos da
// funcionalidade "Ocorrências".
// =================================================================================

import { state, dom } from './state.js';
import { showToast, openModal, closeModal, getStatusBadge, formatDate } from './utils.js';
import { getCollectionRef, getCounterDocRef, updateRecordWithHistory, addRecordWithHistory, deleteRecord } from './firestore.js';
import { openStudentSelectionModal, openOccurrenceRecordModal, openHistoryModal, generateAndShowGeneralReport } from './reports.js';
import { writeBatch, doc, collection, query, where, getDocs, runTransaction } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db } from './firebase.js';

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
 * Renderiza a lista de ocorrências.
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
            const status = record?.statusIndividual || 'Pendente';
            const isMatch = studentSearch && student.name.toLowerCase().includes(studentSearch);
            const nameClass = isMatch ? 'font-bold text-yellow-800' : 'font-medium text-gray-700';
            let borderClass = isMatch ? 'border-yellow-300 bg-yellow-50' : 'border-gray-200 bg-gray-50';
            let hoverClass = isMatch ? 'hover:bg-yellow-100' : 'hover:bg-indigo-50';

            return `
                <button type="button" 
                        class="student-follow-up-trigger flex items-center gap-1.5 py-1 px-2 rounded-lg border ${borderClass} ${hoverClass} cursor-pointer transition-colors"
                        data-group-id="${incident.id}"
                        data-student-id="${student.matricula}"
                        title="Abrir acompanhamento de ${student.name}">
                    <span class="${nameClass}">${student.name}</span>
                    ${getStatusBadge(status)}
                </button>`;
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
                        <div class="relative kebab-menu-container self-center">
                            <button class="kebab-menu-btn text-gray-500 hover:text-gray-800 p-2 rounded-full hover:bg-gray-100" data-group-id="${incident.id}" title="Mais Opções">
                                <i class="fas fa-ellipsis-v"></i>
                            </button>
                            <div class="kebab-menu-dropdown hidden absolute right-0 mt-1 w-48 bg-white rounded-md shadow-lg border z-10">
                                <button class="kebab-action-btn menu-item w-full text-left" data-action="follow-up" data-group-id="${incident.id}"><i class="fas fa-user-check mr-2 w-4"></i>Acompanhamento</button>
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
 * Abre o modal para registrar ou editar os dados COLETIVOS.
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
 * Abre o novo modal de acompanhamento individual.
 */
export const openFollowUpModal = (groupId, studentIdToPreselect = null) => {
    const incident = getFilteredOccurrences().get(groupId);
    if (!incident) return showToast('Erro: Incidente não encontrado.');

    const studentSelect = document.getElementById('follow-up-student-select');
    const studentSelectWrapper = studentSelect.parentElement;
    const followUpForm = document.getElementById('follow-up-form');
    const statusDisplay = document.getElementById('follow-up-status-display'); 
    
    studentSelect.innerHTML = '<option value="">Selecione um aluno...</option>';
    followUpForm.classList.add('hidden');
    if (statusDisplay) statusDisplay.innerHTML = '';

    incident.studentsInvolved.forEach((student, studentId) => {
        const record = incident.records.find(r => r.studentId === studentId);
        if (record) {
            const option = document.createElement('option');
            option.value = record.id;
            option.textContent = student.name;
            option.dataset.studentId = studentId;
            studentSelect.appendChild(option);
        }
    });

    studentSelect.onchange = (e) => {
        const selectedOption = e.target.options[e.target.selectedIndex];
        const recordId = selectedOption.value;
        if (!recordId) {
            followUpForm.classList.add('hidden');
            if (statusDisplay) statusDisplay.innerHTML = '';
            return;
        }
        
        const studentId = selectedOption.dataset.studentId;
        const record = incident.records.find(r => r.id === recordId);
        const student = incident.studentsInvolved.get(studentId);

        if (record && student) {
            followUpForm.dataset.recordId = recordId;
            followUpForm.dataset.studentId = studentId;
            document.getElementById('follow-up-student-name').value = student.name;

            let statusText = 'Pendente';
            if (record.parecerIndividual) statusText = 'Resolvido';
            else if (!record.contactSucceeded || record.contactSucceeded === 'no') statusText = 'Aguardando Contato';
            if (statusDisplay) statusDisplay.innerHTML = `<strong>Status:</strong> ${getStatusBadge(statusText)}`;
            
            document.getElementById('follow-up-actions').value = record.schoolActionsIndividual || '';
            document.getElementById('follow-up-family-actions').value = record.providenciasFamilia || ''; 
            document.getElementById('follow-up-parecer').value = record.parecerIndividual || '';
            document.getElementById('follow-up-meeting-date').value = record.meetingDate || ''; 
            document.getElementById('follow-up-meeting-time').value = record.meetingTime || ''; 

            const contactRadio = document.querySelector(`input[name="follow-up-contact-succeeded"][value="${record.contactSucceeded}"]`);
            if (contactRadio) contactRadio.checked = true;
            else document.querySelectorAll('input[name="follow-up-contact-succeeded"]').forEach(radio => radio.checked = false);
            
            const contactFieldsContainer = document.getElementById('follow-up-family-contact-fields'); 
            if (contactFieldsContainer) {
                // Importar toggleFamilyContactFields de absence.js ou movê-lo para utils.js
                // Por enquanto, vamos replicar a lógica simples
                contactFieldsContainer.classList.toggle('hidden', record.contactSucceeded !== 'yes');
            }

            document.getElementById('follow-up-contact-type').value = record.contactType || ''; 
            document.getElementById('follow-up-contact-date').value = record.contactDate || ''; 
            
            followUpForm.classList.remove('hidden');
        }
    };
    
    if (studentIdToPreselect) {
        const record = incident.records.find(r => r.studentId === studentIdToPreselect);
        if (record) {
            studentSelect.value = record.id;
            studentSelectWrapper.classList.add('hidden');
            studentSelect.dispatchEvent(new Event('change'));
        } else {
            studentSelectWrapper.classList.remove('hidden');
            studentSelect.value = "";
            studentSelect.dispatchEvent(new Event('change'));
        }
    } else {
        studentSelectWrapper.classList.remove('hidden');
        studentSelect.value = "";
        studentSelect.dispatchEvent(new Event('change'));
    }
    openModal(dom.followUpModal);
};


// --- Funções de Handler (Movidas de main.js) ---

/**
 * Lida com a submissão do formulário de ocorrências (criação ou edição do FATO COLETIVO).
 */
async function handleOccurrenceSubmit(e) {
    e.preventDefault();
    const groupId = document.getElementById('occurrence-group-id').value;
    if (state.selectedStudents.size === 0) return showToast("Selecione pelo menos um aluno.");

    const collectiveData = {
        date: document.getElementById('occurrence-date').value,
        occurrenceType: document.getElementById('occurrence-type').value,
        description: document.getElementById('description').value.trim(),
    };

    try {
        if (groupId) {
            // --- MODO DE EDIÇÃO DO FATO ---
            const originalIncident = getFilteredOccurrences().get(groupId);
            if (!originalIncident) throw new Error("Incidente original não encontrado.");

            const historyAction = "Dados gerais do fato foram atualizados.";
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
                    const templateRecord = originalIncident.records[0] || {};
                    const newRecordData = { ...collectiveData, studentId, occurrenceGroupId: groupId, statusIndividual: 'Aguardando Contato', schoolActionsIndividual: '', providenciasFamilia: '', parecerIndividual: '', meetingDate: null, meetingTime: null, contactSucceeded: null, contactType: null, contactDate: null, history: templateRecord.history || [], createdAt: new Date(), createdBy: state.userEmail };
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
                const recordData = { ...collectiveData, studentId, occurrenceGroupId: newGroupId, statusIndividual: 'Aguardando Contato', schoolActionsIndividual: '', providenciasFamilia: '', parecerIndividual: '', meetingDate: null, meetingTime: null, contactSucceeded: null, contactType: null, contactDate: null };
                await addRecordWithHistory('occurrence', recordData, 'Incidente registado', state.userEmail);
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
 * Lida com a submissão do formulário de acompanhamento individual.
 */
async function handleFollowUpSubmit(e) {
    e.preventDefault();
    const studentId = dom.followUpForm.dataset.studentId;
    const recordId = dom.followUpForm.dataset.recordId;
    if (!studentId || !recordId) return showToast("Erro: ID do aluno ou do registo não encontrado.");

    const parecer = document.getElementById('follow-up-parecer').value.trim();
    const contactSucceededRadio = document.querySelector('input[name="follow-up-contact-succeeded"]:checked');
    const contactSucceeded = contactSucceededRadio ? contactSucceededRadio.value : null;

    let newStatus = 'Pendente';
    if (parecer) newStatus = 'Resolvido';
    else if (!contactSucceeded || contactSucceeded === 'no') newStatus = 'Aguardando Contato';

    const dataToUpdate = {
        schoolActionsIndividual: document.getElementById('follow-up-actions').value.trim(),
        providenciasFamilia: document.getElementById('follow-up-family-actions').value.trim(),
        parecerIndividual: parecer,
        meetingDate: document.getElementById('follow-up-meeting-date').value || null,
        meetingTime: document.getElementById('follow-up-meeting-time').value || null,
        contactSucceeded: contactSucceeded,
        contactType: contactSucceeded === 'yes' ? document.getElementById('follow-up-contact-type').value : null,
        contactDate: contactSucceeded === 'yes' ? document.getElementById('follow-up-contact-date').value : null,
        statusIndividual: newStatus
    };

    const historyAction = `Acompanhamento atualizado (Status: ${dataToUpdate.statusIndividual}).`;

    try {
        await updateRecordWithHistory('occurrence', recordId, dataToUpdate, historyAction, state.userEmail);
        showToast("Acompanhamento salvo com sucesso!");
        closeModal(dom.followUpModal);
    } catch (error) {
        console.error("Erro ao salvar acompanhamento:", error);
        showToast('Erro ao salvar o acompanhamento.');
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


// --- Função Principal de Inicialização (Nova) ---

/**
 * Anexa todos os listeners de eventos relacionados a Ocorrências.
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
    dom.followUpForm.addEventListener('submit', handleFollowUpSubmit);

    // Listener de clique para a lista (delegação de eventos)
    dom.occurrencesListDiv.addEventListener('click', (e) => {
        const button = e.target.closest('button');
        if (!button) return;

        // Clique direto no aluno para acompanhamento
        const followUpTrigger = e.target.closest('.student-follow-up-trigger');
        if (followUpTrigger) {
            e.stopPropagation();
            const groupId = followUpTrigger.dataset.groupId;
            const studentId = followUpTrigger.dataset.studentId;
            openFollowUpModal(groupId, studentId);
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

        const groupId = button.dataset.groupId;
        e.stopPropagation();

        if (button.classList.contains('notification-btn')) {
            openStudentSelectionModal(groupId);
        } else if (button.classList.contains('record-btn')) {
            openOccurrenceRecordModal(groupId);
        } else if (button.classList.contains('kebab-action-btn')) {
            const action = button.dataset.action;
            if (action === 'edit') handleEditOccurrence(groupId);
            else if (action === 'delete') handleDelete('occurrence', groupId); // Reusa o handler genérico de delete
            else if (action === 'history') openHistoryModal(groupId);
            else if (action === 'follow-up') openFollowUpModal(groupId);
            
            button.closest('.kebab-menu-dropdown').classList.add('hidden');
        }
    });

    // Listener para o rádio de contato no modal de Follow-Up
    document.querySelectorAll('input[name="follow-up-contact-succeeded"]').forEach(radio =>
        radio.addEventListener('change', (e) => {
            const enable = e.target.value === 'yes';
            // Simula a lógica de toggleFamilyContactFields
            const contactFieldsContainer = document.getElementById('follow-up-family-contact-fields');
            if(contactFieldsContainer) contactFieldsContainer.classList.toggle('hidden', !enable);
            
            const familyActionsTextarea = document.getElementById('follow-up-family-actions');
            if (familyActionsTextarea) {
                familyActionsTextarea.required = enable;
                const label = familyActionsTextarea.closest('div').querySelector('label');
                if (label) {
                    label.innerHTML = enable
                        ? 'Providências da Família <span class="text-red-500">*</span>'
                        : 'Providências da Família';
                }
            }
        })
    );
};
