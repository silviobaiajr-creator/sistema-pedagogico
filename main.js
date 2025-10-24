// =================================================================================
// ARQUIVO: main.js
// RESPONSABILIDADE: Ponto de entrada da aplicação. Orquestra a lógica de
// eventos, submissão de formulários e a comunicação entre a UI e o Firestore.
//
// ATUALIZAÇÃO (REFATORAÇÃO PASSO 4 - MÓDULO DE ADMIN):
// 1. Importado o 'initAdmin' de 'module-admin.js'.
// 2. 'initAdmin()' é chamado após o login bem-sucedido.
// 3. Removidas as importações de 'ui.js' relacionadas a admin.
// 4. Removidos todos os handlers de admin ('handleSettingsSubmit',
//    'handleStudentFormSubmit', 'handleCsvUpload', 'handleStudentTableActions').
// 5. Removidos os event listeners de admin de 'setupEventListeners'.
// =================================================================================

// --- MÓDULOS IMPORTADOS ---

// Serviços do Firebase
import { onSnapshot, query, writeBatch, doc, setDoc, where, getDocs, collection, runTransaction } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Módulos internos da aplicação
import { db } from './firebase.js';
import { state, dom, initializeDOMReferences } from './state.js';
import { showToast, closeModal, shareContent, openModal } from './utils.js';
import { loadStudents, saveSchoolConfig, loadSchoolConfig, getCollectionRef, getStudentsDocRef, getCounterDocRef, updateRecordWithHistory, addRecordWithHistory, deleteRecord } from './firestore.js';

// Funções de UI
import { 
    render, 
    // renderStudentsList, // MOVIDO para module-admin.js
    openOccurrenceModal,
    handleNewAbsenceAction,
    setupAutocomplete,
    openAbsenceModalForStudent,
    // resetStudentForm, // MOVIDO para module-admin.js
    toggleFamilyContactFields,
    toggleVisitContactFields,
    getFilteredOccurrences,
    // openSettingsModal, // MOVIDO para module-admin.js
    openFollowUpModal 
} from './ui.js';

// Funções de Relatório
import {
    openStudentSelectionModal,
    openOccurrenceRecordModal,
    openHistoryModal,
    openAbsenceHistoryModal,
    openFichaViewModal,
    generateAndShowConsolidatedFicha,
    generateAndShowOficio,
    generateAndShowGeneralReport,
    generateAndShowBuscaAtivaReport
} from './reports.js';

// Módulos de Funcionalidade
import { initAuth } from './module-auth.js';
import { initAdmin } from './module-admin.js'; // NOVO

import * as logic from './logic.js';

// --- INICIALIZAÇÃO DA APLICAÇÃO ---

document.addEventListener('DOMContentLoaded', () => {
    initializeDOMReferences();
    state.db = db;
    initAuth(initializeAppState, clearAppState);
    setupEventListeners(); // Configura listeners globais (Abas, Modais, etc.)
    
    // Configura autocomplete (ainda é global)
    setupAutocomplete('search-absences', 'absence-student-suggestions', handleNewAbsenceAction);
});

// --- FUNÇÕES DE CALLBACK PARA AUTENTICAÇÃO ---

async function initializeAppState(user) {
    detachFirestoreListeners(); 

    state.userId = user.uid;
    state.userEmail = user.email;
    
    try {
        await loadSchoolConfig(); 
        await loadStudents();
        dom.headerSchoolName.textContent = state.config.schoolName || 'Sistema de Acompanhamento';
        
        setupFirestoreListeners();
        
        // NOVO: Inicializa o módulo de administração
        initAdmin(); 
        
        // (Futuro: initOccurrences() e initAbsences() virão aqui)

        render();
    } catch (error) {
        showToast(error.message);
    }
}

function clearAppState() {
    detachFirestoreListeners(); 

    state.userId = null;
    state.userEmail = null;
    state.students = [];
    state.occurrences = [];
    state.absences = [];
    
    render();
}


// --- SINCRONIZAÇÃO COM O BANCO DE DADOS (FIRESTORE) ---

function setupFirestoreListeners() {
    if (!state.userId) return;

    const occurrencesQuery = query(getCollectionRef('occurrence'));
    state.unsubscribeOccurrences = onSnapshot(occurrencesQuery, (snapshot) => {
        state.occurrences = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (state.activeTab === 'occurrences') render();
    }, (error) => console.error("Erro ao buscar ocorrências:", error));

    const absencesQuery = query(getCollectionRef('absence'));
    state.unsubscribeAbsences = onSnapshot(absencesQuery, (snapshot) => {
        state.absences = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (state.activeTab === 'absences') render();
    }, (error) => console.error("Erro ao buscar ações:", error));
};

function detachFirestoreListeners() {
    if (state.unsubscribeOccurrences) state.unsubscribeOccurrences();
    if (state.unsubscribeAbsences) state.unsubscribeAbsences();
    state.unsubscribeOccurrences = null;
    state.unsubscribeAbsences = null;
};

// --- CONFIGURAÇÃO CENTRAL DE EVENTOS DA UI ---

function setupEventListeners() {
    // Navegação por Abas
    dom.tabOccurrences.addEventListener('click', () => switchTab('occurrences'));
    dom.tabAbsences.addEventListener('click', () => switchTab('absences'));

    // Submissão de Formulários (O que restou)
    dom.occurrenceForm.addEventListener('submit', handleOccurrenceSubmit);
    dom.absenceForm.addEventListener('submit', handleAbsenceSubmit);
    // dom.settingsForm.addEventListener('submit', handleSettingsSubmit); // MOVIDO
    dom.followUpForm.addEventListener('submit', handleFollowUpSubmit);

    // Fechar Modais
    setupModalCloseButtons();

    // --- Ocorrências: Listeners ---
    document.getElementById('add-occurrence-btn').addEventListener('click', () => openOccurrenceModal());
    dom.searchOccurrences.addEventListener('input', (e) => { state.filterOccurrences = e.target.value; render(); });
    dom.occurrenceStartDate.addEventListener('change', (e) => { state.filtersOccurrences.startDate = e.target.value; render(); });
    dom.occurrenceEndDate.addEventListener('change', (e) => { state.filtersOccurrences.endDate = e.target.value; render(); });
    document.getElementById('occurrence-filter-type').addEventListener('change', (e) => { state.filtersOccurrences.type = e.target.value; render(); });
    document.getElementById('occurrence-filter-status').addEventListener('change', (e) => { state.filtersOccurrences.status = e.target.value; render(); });
    dom.generalReportBtn.addEventListener('click', generateAndShowGeneralReport);

    // --- Busca Ativa: Listeners ---
    document.getElementById('general-ba-report-btn').addEventListener('click', generateAndShowBuscaAtivaReport);
    document.getElementById('filter-process-status').addEventListener('change', (e) => { state.filtersAbsences.processStatus = e.target.value; render(); });
    document.getElementById('filter-pending-action').addEventListener('change', (e) => { state.filtersAbsences.pendingAction = e.target.value; render(); });
    document.getElementById('filter-return-status').addEventListener('change', (e) => { state.filtersAbsences.returnStatus = e.target.value; render(); });
    
    // Gerenciamento de Alunos e Configurações (MOVIDOS PARA module-admin.js)
    // document.getElementById('manage-students-btn').addEventListener('click', ...);
    // document.getElementById('upload-csv-btn').addEventListener('click', handleCsvUpload);
    // document.getElementById('student-form').addEventListener('submit', handleStudentFormSubmit);
    // document.getElementById('cancel-edit-student-btn').addEventListener('click', resetStudentForm);
    // dom.settingsBtn.addEventListener('click', openSettingsModal);

    // Ações nas Listas (Ocorrências e Busca Ativa)
    setupListClickListeners();

    // Listener centralizado para a tabela de alunos. (MOVIDO)
    // dom.studentsListTable.addEventListener('click', handleStudentTableActions);

    // Ações em Modais (Globais)
    document.getElementById('confirm-delete-btn').addEventListener('click', handleDeleteConfirmation);
    document.getElementById('action-type').addEventListener('change', (e) => handleActionTypeChange(e.target.value));
    
    // Listeners para os rádios da Busca Ativa (mostra/esconde campos)
    document.querySelectorAll('input[name="contact-succeeded"]').forEach(radio => radio.addEventListener('change', (e) => toggleFamilyContactFields(e.target.value === 'yes', document.getElementById('family-contact-fields'))));
    document.querySelectorAll('input[name="visit-succeeded"]').forEach(radio => radio.addEventListener('change', (e) => toggleVisitContactFields(e.target.value === 'yes', document.getElementById('visit-contact-fields'))));
    
    document.querySelectorAll('input[name="follow-up-contact-succeeded"]').forEach(radio => 
        radio.addEventListener('change', (e) => {
            const enable = e.target.value === 'yes';
            toggleFamilyContactFields(enable, document.getElementById('follow-up-family-contact-fields'));
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

    // Listener global para fechar menus kebab
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.kebab-menu-container')) {
            document.querySelectorAll('.kebab-menu-dropdown').forEach(d => d.classList.add('hidden'));
            document.querySelectorAll('.process-content').forEach(c => {
                if (c.style.maxHeight && c.style.maxHeight !== '0px') {
                    c.style.overflow = 'hidden';
                }
            });
        }
    });
}

// --- HANDLERS E FUNÇÕES AUXILIARES ---

// REMOVIDO: function getFirestoreErrorMessage(code) { ... } (Movido para module-admin.js)

function switchTab(tabName) {
    state.activeTab = tabName;
    const isOccurrences = tabName === 'occurrences';
    dom.tabOccurrences.classList.toggle('tab-active', isOccurrences);
    dom.tabAbsences.classList.toggle('tab-active', !isOccurrences);
    dom.tabContentOccurrences.classList.toggle('hidden', !isOccurrences);
    dom.tabContentAbsences.classList.toggle('hidden', isOccurrences);
    render();
}

/**
 * Lida com a submissão do formulário de ocorrências (criação ou edição do FATO COLETIVO).
 */
async function handleOccurrenceSubmit(e) {
    e.preventDefault();
    const groupId = document.getElementById('occurrence-group-id').value;
    
    if (state.selectedStudents.size === 0) {
        return showToast("Selecione pelo menos um aluno.");
    }
    
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
                    
                    const newRecordData = { 
                        ...collectiveData, 
                        studentId, 
                        occurrenceGroupId: groupId,
                        statusIndividual: 'Aguardando Contato', 
                        schoolActionsIndividual: '',
                        providenciasFamilia: '', 
                        parecerIndividual: '',
                        meetingDate: null, 
                        meetingTime: null, 
                        contactSucceeded: null, 
                        contactType: null, 
                        contactDate: null, 
                        history: templateRecord.history || [], 
                        createdAt: new Date(),
                        createdBy: state.userEmail
                    };
                    batch.set(newRecordRef, newRecordData);
                }
            }

            const removedStudentIds = originalIncident.records
                .map(r => r.studentId)
                .filter(id => !studentIdsInvolved.includes(id));

            for (const studentId of removedStudentIds) {
                const recordToDelete = originalIncident.records.find(r => r.studentId === studentId);
                if (recordToDelete) {
                    batch.delete(doc(getCollectionRef('occurrence'), recordToDelete.id));
                }
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
                    statusIndividual: 'Aguardando Contato', 
                    schoolActionsIndividual: '',
                    providenciasFamilia: '', 
                    parecerIndividual: '',
                    meetingDate: null, 
                    meetingTime: null, 
                    contactSucceeded: null, 
                    contactType: null, 
                    contactDate: null, 
                };
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
    
    if (!studentId || !recordId) {
        return showToast("Erro: ID do aluno ou do registo não encontrado.");
    }

    const parecer = document.getElementById('follow-up-parecer').value.trim();
    const contactSucceededRadio = document.querySelector('input[name="follow-up-contact-succeeded"]:checked');
    const contactSucceeded = contactSucceededRadio ? contactSucceededRadio.value : null;
    
    let newStatus = 'Pendente';
    if (parecer) {
        newStatus = 'Resolvido';
    } else if (!contactSucceeded || contactSucceeded === 'no') {
        newStatus = 'Aguardando Contato';
    }

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


async function handleAbsenceSubmit(e) {
    e.preventDefault();
    const form = e.target;
    if (!form.checkValidity()) {
        form.reportValidity();
        return showToast('Por favor, preencha todos os campos obrigatórios.');
    }
    
    const data = getAbsenceFormData();
    if (!data) return;

    try {
        const id = data.id;
        delete data.id;
        
        const historyAction = id ? "Dados da ação atualizados." : `Ação de Busca Ativa registada.`;

        if (id) {
            await updateRecordWithHistory('absence', id, data, historyAction, state.userEmail);
        } else {
            await addRecordWithHistory('absence', data, historyAction, state.userEmail);
        }

        showToast(`Ação ${id ? 'atualizada' : 'registada'} com sucesso!`);
        closeModal(dom.absenceModal);
        
        const studentReturned = data.contactReturned === 'yes' || data.visitReturned === 'yes';
        if (studentReturned) {
            const student = state.students.find(s => s.matricula === data.studentId);
            setTimeout(() => openAbsenceModalForStudent(student, 'analise'), 350);
        }
    } catch (error) { 
        console.error("Erro ao salvar ação de BA:", error);
        showToast('Erro ao salvar ação.'); 
    }
}

// REMOVIDO: async function handleSettingsSubmit(e) { ... } (Movido para module-admin.js)

// Funções de Gerenciamento de Alunos (REMOVIDAS - Movidas para module-admin.js)
// REMOVIDO: function handleCsvUpload() { ... }
// REMOVIDO: async function handleStudentFormSubmit(e) { ... }

// Ações (Excluir, Gerar Relatório)
async function handleDeleteConfirmation() {
    if (!state.recordToDelete) return;
    const { type, id } = state.recordToDelete;
    try {
        if (type === 'occurrence') {
            const q = query(getCollectionRef('occurrence'), where('occurrenceGroupId', '==', id));
            const querySnapshot = await getDocs(q);
            const batch = writeBatch(db);
            querySnapshot.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
            showToast('Incidente e todos os registros associados foram excluídos.');
        } else if (type === 'absence-cascade') {
            const { ctId, analiseId } = state.recordToDelete;
            const batch = writeBatch(db);
            batch.delete(doc(getCollectionRef('absence'), ctId));
            if (analiseId) batch.delete(doc(getCollectionRef('absence'), analiseId));
            await batch.commit();
            showToast('Encaminhamento e Análise excluídos.');
        } else {
            await deleteRecord(type, id);
            showToast('Registro excluído com sucesso.');
        }
    } catch (error) { showToast('Erro ao excluir.'); console.error(error); } finally { state.recordToDelete = null; closeModal(dom.deleteConfirmModal); }
}

function handleReportGeneration() {
    const studentId = document.getElementById('student-select').value;
    if (!studentId) return showToast('Por favor, selecione um aluno.');
    const reportType = dom.reportGeneratorModal.dataset.reportType;
    if (reportType === 'occurrences') {
        showToast("Use o Relatório Geral e o filtro de aluno para gerar relatórios individuais.");
    } else {
        generateAndShowConsolidatedFicha(studentId);
    }
    closeModal(dom.reportGeneratorModal);
}

// Lógica de UI e Dados (sem alterações significativas)
function getOccurrenceHistoryMessage(original, updated) {
    return "Dados do incidente foram atualizados.";
}

function getAbsenceFormData() {
    const studentName = document.getElementById('absence-student-name').value.trim();
    const student = state.students.find(s => s.name === studentName);
    if (!student) {
        showToast("Aluno inválido.");
        return null;
    }

    const data = {
        id: document.getElementById('absence-id').value,
        studentId: student.matricula,
        actionType: document.getElementById('action-type').value,
        processId: document.getElementById('absence-process-id').value,
        periodoFaltasStart: document.getElementById('absence-start-date').value || null,
        periodoFaltasEnd: document.getElementById('absence-end-date').value || null,
        absenceCount: document.getElementById('absence-count').value || null,
    };

    if (data.actionType.startsWith('tentativa')) {
        const contactSucceeded = document.querySelector('input[name="contact-succeeded"]:checked');
        data.meetingDate = document.getElementById('meeting-date').value || null;
        data.meetingTime = document.getElementById('meeting-time').value || null;
        data.contactSucceeded = contactSucceeded ? contactSucceeded.value : null;
        if (data.contactSucceeded === 'yes') {
            data.contactType = document.getElementById('absence-contact-type').value || null;
            data.contactDate = document.getElementById('contact-date').value || null;
            data.contactPerson = document.getElementById('contact-person').value || null;
            data.contactReason = document.getElementById('contact-reason').value || null;
        }
        const contactReturned = document.querySelector('input[name="contact-returned"]:checked');
        data.contactReturned = contactReturned ? contactReturned.value : null;
    } else if (data.actionType === 'visita') {
        const visitSucceeded = document.querySelector('input[name="visit-succeeded"]:checked');
        data.visitAgent = document.getElementById('visit-agent').value || null;
        data.visitDate = document.getElementById('visit-date').value || null;
        data.visitSucceeded = visitSucceeded ? visitSucceeded.value : null;
        if (data.visitSucceeded === 'yes') {
            data.visitContactPerson = document.getElementById('visit-contact-person').value || null;
            data.visitReason = document.getElementById('visit-reason').value || null;
            data.visitObs = document.getElementById('visit-obs').value || null;
        }
        const visitReturned = document.querySelector('input[name="visit-returned"]:checked');
        data.visitReturned = visitReturned ? visitReturned.value : null;
    } else if (data.actionType === 'encaminhamento_ct') {
        data.ctSentDate = document.getElementById('ct-sent-date').value || null;
        data.ctFeedback = document.getElementById('ct-feedback').value || null;
        const ctReturned = document.querySelector('input[name="ct-returned"]:checked');
        data.ctReturned = ctReturned ? ctReturned.value : null;
    } else if (data.actionType === 'analise') {
        data.ctParecer = document.getElementById('ct-parecer').value || null;
    }
    return data;
}

function handleActionTypeChange(action) {
    document.querySelectorAll('.dynamic-field-group').forEach(group => group.classList.add('hidden'));
    const groupToShow = action.startsWith('tentativa') ? 'group-tentativas' : `group-${action}`;
    const groupElement = document.getElementById(groupToShow);
    if (groupElement) groupElement.classList.remove('hidden');
}

// --- CONFIGURAÇÃO DE LISTENERS DINÂMICOS ---

function setupModalCloseButtons() {
    const modalMap = {
        'close-modal-btn': dom.occurrenceModal, 'cancel-btn': dom.occurrenceModal,
        'close-absence-modal-btn': dom.absenceModal, 'cancel-absence-btn': dom.absenceModal,
        'close-report-generator-btn': dom.reportGeneratorModal, 'cancel-report-generator-btn': dom.reportGeneratorModal,
        'close-notification-btn': dom.notificationModalBackdrop,
        'close-student-selection-modal-btn': document.getElementById('student-selection-modal'),
        'close-report-view-btn': dom.reportViewModalBackdrop,
        'close-ficha-view-btn': dom.fichaViewModalBackdrop,
        'close-history-view-btn': document.getElementById('history-view-modal-backdrop'),
        'close-students-modal-btn': dom.studentsModal,
        'cancel-delete-btn': dom.deleteConfirmModal,
        'close-settings-modal-btn': dom.settingsModal,
        'cancel-settings-btn': dom.settingsModal, 
        'close-follow-up-modal-btn': dom.followUpModal,
        'cancel-follow-up-btn': dom.followUpModal 
    };

    for (const [id, modal] of Object.entries(modalMap)) {
        const button = document.getElementById(id);
        if (button && modal) {
            if (button.hasAttribute('onclick')) {
                button.removeAttribute('onclick');
            }
            button.addEventListener('click', () => closeModal(modal));
        } else if (!button && (id === 'cancel-follow-up-btn' || id === 'close-follow-up-modal-btn')) {
             console.warn(`O botão '${id}' não foi encontrado. Verifique o ID no index.html.`);
        }
    }

    document.getElementById('share-btn').addEventListener('click', () => shareContent(document.getElementById('notification-title').textContent, document.getElementById('notification-content').innerText));
    document.getElementById('report-share-btn').addEventListener('click', () => shareContent(document.getElementById('report-view-title').textContent, document.getElementById('report-view-content').innerText));
    document.getElementById('ficha-share-btn').addEventListener('click', () => shareContent(document.getElementById('ficha-view-title').textContent, document.getElementById('ficha-view-content').innerText));
    document.getElementById('print-btn').addEventListener('click', () => window.print());
    document.getElementById('report-print-btn').addEventListener('click', () => window.print());
    document.getElementById('ficha-print-btn').addEventListener('click', () => window.print());
}

function setupListClickListeners() {
    // Listener para a lista de OCORRÊNCIAS
    dom.occurrencesListDiv.addEventListener('click', (e) => {
        const button = e.target.closest('button');
        if (!button) return;

        const followUpTrigger = e.target.closest('.student-follow-up-trigger');
        if (followUpTrigger) {
            e.stopPropagation();
            const groupId = followUpTrigger.dataset.groupId;
            const studentId = followUpTrigger.dataset.studentId;
            openFollowUpModal(groupId, studentId);
            return;
        }

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
            else if (action === 'delete') handleDelete('occurrence', groupId);
            else if (action === 'history') openHistoryModal(groupId);
            else if (action === 'follow-up') openFollowUpModal(groupId); 
            button.closest('.kebab-menu-dropdown').classList.add('hidden');
        }
    });

    // Listener para a lista de BUSCA ATIVA
    dom.absencesListDiv.addEventListener('click', (e) => {
        const button = e.target.closest('button');
        if (button) {
            e.stopPropagation(); 

             if (button.classList.contains('kebab-menu-btn')) {
                const dropdown = button.nextElementSibling;
                if (dropdown) {
                    document.querySelectorAll('.kebab-menu-dropdown').forEach(d => {
                        if (d !== dropdown) d.classList.add('hidden');
                    });
                    
                    const contentParent = button.closest('.process-content');
                    if (contentParent && dropdown.classList.contains('hidden')) { 
                        contentParent.style.overflow = 'visible';
                    } else if (contentParent) {
                        setTimeout(() => { 
                            if (dropdown.classList.contains('hidden')) {
                                contentParent.style.overflow = 'hidden';
                            }
                        }, 250); 
                    }
                    
                    dropdown.classList.toggle('hidden');
                }
                return; 
            }

            const id = button.dataset.id;
            
            if (button.classList.contains('notification-btn')) openFichaViewModal(id);
            else if (button.classList.contains('send-ct-btn')) handleSendToCT(id);
            else if (button.classList.contains('view-oficio-btn')) handleViewOficio(id);
            else if (button.classList.contains('generate-ficha-btn-row')) generateAndShowConsolidatedFicha(button.dataset.studentId, button.dataset.processId);
            else if (button.classList.contains('kebab-action-btn')) {
                const action = button.dataset.action;
                if (action === 'edit') handleEditAbsence(id);
                else if (action === 'delete') handleDeleteAbsence(id);
                else if (action === 'history') openAbsenceHistoryModal(button.dataset.processId);
                button.closest('.kebab-menu-dropdown').classList.add('hidden');
                const contentParent = button.closest('.process-content');
                if(contentParent) contentParent.style.overflow = 'hidden';
            }
            return;
        }

        // Clique para abrir/fechar o acordeão
        const header = e.target.closest('.process-header');
        if (header) {
            const id = header.dataset.processId;
            const content = document.getElementById(`content-${id}`);
            const icon = header.querySelector('i.fa-chevron-down');
            if (content) {
                const isHidden = !content.style.maxHeight || content.style.maxHeight === '0px';
                if (isHidden) {
                    content.style.maxHeight = `${content.scrollHeight}px`;
                } else {
                    content.style.maxHeight = null;
                    content.style.overflow = 'hidden'; 
                }
                icon?.classList.toggle('rotate-180', isHidden);
            }
            return;
        }
        
        // Clique para iniciar nova ação a partir do histórico
        const newActionTrigger = e.target.closest('.new-action-from-history-btn');
        if (newActionTrigger) {
            e.stopPropagation();
            handleNewAbsenceFromHistory(newActionTrigger.dataset.studentId);
            return;
        }
    });
}

// Funções de Manipulação de Eventos das Listas (sem alterações significativas)
function handleEditOccurrence(groupId) {
    const incident = getFilteredOccurrences().get(groupId);
    if (incident) {
        openOccurrenceModal(incident);
    } else {
        showToast('Incidente não encontrado para edição.');
    }
}

function handleDelete(type, id) {
    document.getElementById('delete-confirm-message').textContent = 'Tem certeza que deseja excluir este incidente e todos os seus registros? Esta ação não pode ser desfeita.';
    state.recordToDelete = { type, id };
    openModal(dom.deleteConfirmModal);
}

function handleEditAbsence(id) {
    const data = state.absences.find(a => a.id === id);
    const student = data ? state.students.find(s => s.matricula === data.studentId) : null;
    if (student) openAbsenceModalForStudent(student, data.actionType, data);
}

function handleDeleteAbsence(id) {
    const actionToDelete = state.absences.find(a => a.id === id);
    if (!actionToDelete) return;

    const sequence = ['tentativa_1', 'tentativa_2', 'tentativa_3', 'visita', 'encaminhamento_ct', 'analise'];
    const processActions = state.absences.filter(a => a.processId === actionToDelete.processId);
    const deleteIndex = sequence.indexOf(actionToDelete.actionType);
    const hasLaterAction = processActions.some(a => sequence.indexOf(a.actionType) > deleteIndex);

    if (hasLaterAction) return showToast("Exclua a etapa mais recente do processo primeiro.");
    
    if (actionToDelete.actionType === 'encaminhamento_ct') {
        const analiseAction = processActions.find(a => a.actionType === 'analise');
        document.getElementById('delete-confirm-message').textContent = 'A etapa de Análise associada também será excluída. Deseja continuar?';
        state.recordToDelete = { type: 'absence-cascade', ctId: id, analiseId: analiseAction ? analiseAction.id : null };
    } else {
        document.getElementById('delete-confirm-message').textContent = 'Tem certeza que deseja excluir este registro?';
        state.recordToDelete = { type: 'absence', id: id };
    }
    openModal(dom.deleteConfirmModal);
}

async function handleSendToCT(id) {
    const oficioNumber = prompt("Por favor, insira o número do ofício:");
    if (oficioNumber?.trim()) {
        const visitAction = state.absences.find(a => a.id === id);
        if (visitAction) {
            generateAndShowOficio(visitAction, oficioNumber);
            const student = state.students.find(s => s.matricula === visitAction.studentId);
            if (!student) return;

            const { processId, currentCycleActions } = logic.getStudentProcessInfo(student.matricula);
            if (currentCycleActions.some(a => a.actionType === 'encaminhamento_ct')) return;

            const firstAction = currentCycleActions.find(a => a.periodoFaltasStart);
            const dataForCt = {
                studentId: student.matricula, actionType: 'encaminhamento_ct', processId,
                ctSentDate: new Date().toISOString().split('T')[0],
                oficioNumber, oficioYear: new Date().getFullYear(),
                periodoFaltasStart: firstAction?.periodoFaltasStart || null,
                periodoFaltasEnd: firstAction?.periodoFaltasEnd || null,
                absenceCount: firstAction?.absenceCount || null,
            };
            try {
                await addRecordWithHistory('absence', dataForCt, "Ação 'Encaminhamento ao CT' registada.", state.userEmail);
                showToast("Registro de 'Encaminhamento ao CT' salvo automaticamente.");
            } catch(err) {
                showToast("Erro ao salvar o encaminhamento automático.");
            }
        }
    }
}

function handleViewOficio(id) {
    const ctAction = state.absences.find(a => a.id === id);
    if (ctAction) generateAndShowOficio(ctAction);
}

function handleNewAbsenceFromHistory(studentId) {
    const student = state.students.find(s => s.matricula === studentId);
    if (student) handleNewAbsenceAction(student);
}

// REMOVIDO: async function handleStudentTableActions(e) { ... } (Movido para module-admin.js)

