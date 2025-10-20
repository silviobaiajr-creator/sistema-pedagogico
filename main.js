// =================================================================================
// ARQUIVO: main.js
// RESPONSABILIDADE: Ponto de entrada da aplicação. Orquestra todos os outros
// módulos, configura os listeners de eventos e a autenticação do usuário.
// =================================================================================

// --- MÓDULOS IMPORTADOS ---

// Serviços do Firebase para autenticação e banco de dados
import { onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { onSnapshot, query, writeBatch, doc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Módulos internos da aplicação
import { auth, db } from './firebase.js';
import { state, dom } from './state.js';
import { showToast, closeModal, shareContent, openModal } from './utils.js';
import { loadStudents, getCollectionRef, addRecord, updateRecord, deleteRecord, updateOccurrenceRecord } from './firestore.js';
import { 
    render, 
    renderStudentsList, 
    openOccurrenceModalForStudent,
    handleNewAbsenceAction,
    setupAutocomplete,
    openNotificationModal,
    openHistoryModal, // <-- Importação adicionada
    openFichaViewModal,
    generateAndShowReport,
    generateAndShowConsolidatedFicha,
    generateAndShowOficio,
    openAbsenceModalForStudent,
    showLoginView,
    showRegisterView,
    resetStudentForm,
    toggleFamilyContactFields,
    toggleVisitContactFields,
    generateAndShowGeneralReport
} from './ui.js';
import * as logic from './logic.js';

// --- INICIALIZAÇÃO DA APLICAÇÃO ---

document.addEventListener('DOMContentLoaded', () => {
    state.db = db; // Armazena a instância do DB no estado global

    // Observador do estado de autenticação do Firebase
    onAuthStateChanged(auth, async user => {
        detachFirestoreListeners(); // Limpa listeners antigos para evitar duplicação
        
        if (user) {
            // Utilizador AUTENTICADO
            state.userId = user.uid;
            state.userEmail = user.email; // Armazena o email para auditoria
            dom.userEmail.textContent = user.email || `Utilizador: ${user.uid.substring(0, 8)}`;
            
            // Exibe a UI principal e esconde a de login
            dom.loginScreen.classList.add('hidden');
            dom.mainContent.classList.remove('hidden');
            dom.userProfile.classList.remove('hidden');
            
            try {
                await loadStudents(); // Carrega a lista de alunos do Firestore
                setupFirestoreListeners(); // Configura a sincronização em tempo real
                render(); // Renderiza a UI inicial
            } catch (error) {
                showToast(error.message);
            }
        } else {
            // Utilizador NÃO AUTENTICADO
            state.userId = null;
            state.userEmail = null;
            state.students = [];
            state.occurrences = [];
            state.absences = [];
            
            // Exibe a UI de login e esconde a principal
            dom.mainContent.classList.add('hidden');
            dom.userProfile.classList.add('hidden');
            dom.loginScreen.classList.remove('hidden');
            render();
        }
    });

    // Configura todos os event listeners da aplicação
    setupEventListeners();
    
    // Inicia a funcionalidade de autocompletar para as barras de busca
    setupAutocomplete('search-occurrences', 'occurrence-student-suggestions', openOccurrenceModalForStudent); 
    setupAutocomplete('search-absences', 'absence-student-suggestions', handleNewAbsenceAction);
});

// --- SINCRONIZAÇÃO COM O BANCO DE DADOS (FIRESTORE) ---

// Configura os listeners para ouvir mudanças em tempo real nas coleções
function setupFirestoreListeners() {
    if (!state.userId) return;

    // Listener para a coleção de Ocorrências
    const occurrencesQuery = query(getCollectionRef('occurrence'));
    state.unsubscribeOccurrences = onSnapshot(occurrencesQuery, (snapshot) => {
        state.occurrences = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (state.activeTab === 'occurrences') render(); // Re-renderiza se a aba estiver ativa
    }, (error) => console.error("Erro ao buscar ocorrências:", error));

    // Listener para a coleção de Busca Ativa (Absences)
    const absencesQuery = query(getCollectionRef('absence'));
    state.unsubscribeAbsences = onSnapshot(absencesQuery, (snapshot) => {
        state.absences = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (state.activeTab === 'absences') render(); // Re-renderiza se a aba estiver ativa
    }, (error) => console.error("Erro ao buscar ações:", error));
};

// Remove os listeners para evitar vazamentos de memória ao deslogar
function detachFirestoreListeners() {
    if (state.unsubscribeOccurrences) state.unsubscribeOccurrences();
    if (state.unsubscribeAbsences) state.unsubscribeAbsences();
    state.unsubscribeOccurrences = null;
    state.unsubscribeAbsences = null;
};

// --- CONFIGURAÇÃO CENTRAL DE EVENTOS DA UI ---

function setupEventListeners() {
    // Formulários de Autenticação
    dom.loginForm.addEventListener('submit', handleLogin);
    dom.registerForm.addEventListener('submit', handleRegister);
    dom.logoutBtn.addEventListener('click', () => signOut(auth));
    dom.showRegisterViewBtn.addEventListener('click', showRegisterView);
    dom.showLoginViewBtn.addEventListener('click', showLoginView);
    
    // Navegação por Abas
    dom.tabOccurrences.addEventListener('click', () => switchTab('occurrences'));
    dom.tabAbsences.addEventListener('click', () => switchTab('absences'));

    // Formulários principais
    dom.occurrenceForm.addEventListener('submit', handleOccurrenceSubmit);
    dom.absenceForm.addEventListener('submit', handleAbsenceSubmit);

    // Fechamento de Modais
    setupModalCloseButtons();

    // Filtros e Relatórios
    dom.occurrenceStartDate.addEventListener('change', (e) => { state.filtersOccurrences.startDate = e.target.value; render(); });
    dom.occurrenceEndDate.addEventListener('change', (e) => { state.filtersOccurrences.endDate = e.target.value; render(); });
    document.getElementById('filter-process-status').addEventListener('change', (e) => { state.filtersAbsences.processStatus = e.target.value; render(); });
    document.getElementById('filter-pending-action').addEventListener('change', (e) => { state.filtersAbsences.pendingAction = e.target.value; render(); });
    document.getElementById('filter-return-status').addEventListener('change', (e) => { state.filtersAbsences.returnStatus = e.target.value; render(); });
    dom.generalReportBtn.addEventListener('click', generateAndShowGeneralReport);
    
    // Gerenciamento de Alunos
    document.getElementById('manage-students-btn').addEventListener('click', () => { renderStudentsList(); openModal(dom.studentsModal); });
    document.getElementById('upload-csv-btn').addEventListener('click', logic.handleCsvUpload);
    document.getElementById('student-form').addEventListener('submit', logic.handleStudentFormSubmit);
    document.getElementById('cancel-edit-student-btn').addEventListener('click', resetStudentForm);

    // Delegação de eventos para cliques nas listas de Ocorrências e Busca Ativa
    setupListClickListeners();

    // Confirmação de exclusão
    document.getElementById('confirm-delete-btn').addEventListener('click', handleDeleteConfirmation);

    // Gerador de relatório individual
    document.getElementById('create-report-btn').addEventListener('click', handleReportGeneration);

    // Campos dinâmicos no modal de Busca Ativa
    document.getElementById('action-type').addEventListener('change', (e) => logic.handleActionTypeChange(e.target.value));
    document.querySelectorAll('input[name="contact-succeeded"]').forEach(radio => radio.addEventListener('change', (e) => toggleFamilyContactFields(e.target.value === 'yes', document.getElementById('family-contact-fields'))));
    document.querySelectorAll('input[name="visit-succeeded"]').forEach(radio => radio.addEventListener('change', (e) => toggleVisitContactFields(e.target.value === 'yes', document.getElementById('visit-contact-fields'))));
}

// --- HANDLERS DE EVENTOS (LÓGICA DOS LISTENERS) ---

async function handleLogin(e) {
    e.preventDefault();
    const email = dom.loginForm.email.value;
    const password = dom.loginForm.password.value;
    try {
        await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
        showToast("Email ou senha inválidos.");
    }
}

async function handleRegister(e) {
    e.preventDefault();
    const email = dom.registerForm.email.value;
    const password = dom.registerForm.password.value;
    try {
        await createUserWithEmailAndPassword(auth, email, password);
    } catch (error) {
        const message = logic.getAuthErrorMessage(error.code);
        showToast(message);
    }
}

function switchTab(tabName) {
    state.activeTab = tabName;
    const isOccurrences = tabName === 'occurrences';
    
    dom.tabOccurrences.classList.toggle('tab-active', isOccurrences);
    dom.tabAbsences.classList.toggle('tab-active', !isOccurrences);
    
    dom.tabContentOccurrences.classList.toggle('hidden', !isOccurrences);
    dom.tabContentAbsences.classList.toggle('hidden', isOccurrences);
    
    render();
}

async function handleOccurrenceSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('occurrence-id').value;
    const studentName = document.getElementById('student-name').value.trim();
    const student = state.students.find(s => s.name === studentName);
    if (!student) return showToast("Aluno inválido. Por favor, selecione um aluno da lista.");
    
    const data = { 
        studentId: student.matricula,
        date: document.getElementById('occurrence-date').value, 
        occurrenceType: document.getElementById('occurrence-type').value,
        status: document.getElementById('occurrence-status').value, 
        description: document.getElementById('description').value.trim(), 
        involved: document.getElementById('involved').value.trim(), 
        actionsTakenSchool: document.getElementById('actions-taken-school').value.trim(), 
        actionsTakenFamily: document.getElementById('actions-taken-family').value.trim(), 
        meetingDate: document.getElementById('meeting-date-occurrence').value || null, 
        meetingTime: document.getElementById('meeting-time-occurrence').value || null
    };
    
    try { 
        if (id) {
            // Edição de ocorrência existente
            const original = state.occurrences.find(o => o.id === id);
            const historyAction = logic.getOccurrenceHistoryMessage(original, data);
            await updateOccurrenceRecord(id, data, historyAction, state.userEmail);
            showToast('Ocorrência atualizada com sucesso!');
        } else {
            // Criação de nova ocorrência
            await addRecord('occurrence', data, state.userEmail); 
            showToast('Ocorrência registada com sucesso!'); 
        }
        closeModal(dom.occurrenceModal); 
    } catch (error) { 
        showToast('Erro ao salvar ocorrência.'); 
    }
}

async function handleAbsenceSubmit(e) {
    e.preventDefault();
    const form = e.target;
    if (!form.checkValidity()) {
        form.reportValidity();
        return showToast('Por favor, preencha todos os campos obrigatórios.');
    }
    
    const data = logic.getAbsenceFormData();
    if (!data) return; // Se o aluno for inválido, a função retorna null

    try {
        const id = data.id;
        delete data.id; // Remove o ID do objeto de dados antes de salvar

        await (id ? updateRecord('absence', id, data, state.userEmail) : addRecord('absence', data, state.userEmail));
        showToast(`Ação ${id ? 'atualizada' : 'registada'} com sucesso!`);
        closeModal(dom.absenceModal);
        
        const studentReturned = data.contactReturned === 'yes' || data.visitReturned === 'yes';
        if (studentReturned) {
            const student = state.students.find(s => s.matricula === data.studentId);
            setTimeout(() => openAbsenceModalForStudent(student, 'analise'), 350);
        }
    } catch (error) { 
        showToast('Erro ao salvar ação.'); 
    }
}

async function handleDeleteConfirmation() {
    const { type, id, ctId, analiseId } = state.recordToDelete;
    if (!type) return;

    try {
        if (type === 'absence-cascade') {
            const batch = writeBatch(db);
            batch.delete(doc(getCollectionRef('absence'), ctId));
            if (analiseId) {
                batch.delete(doc(getCollectionRef('absence'), analiseId));
            }
            await batch.commit();
            showToast('Encaminhamento e Análise excluídos.');
        } else {
            await deleteRecord(type, id);
            showToast('Registro excluído com sucesso.');
        }
    } catch (error) {
        showToast('Erro ao excluir.');
    } finally {
        state.recordToDelete = null;
        closeModal(dom.deleteConfirmModal);
    }
}

function handleReportGeneration() {
    const studentId = document.getElementById('student-select').value;
    if (!studentId) return showToast('Por favor, selecione um aluno.');
    
    const reportType = dom.reportGeneratorModal.dataset.reportType;
    if (reportType === 'occurrences') generateAndShowReport(studentId);
    else generateAndShowConsolidatedFicha(studentId);
    
    closeModal(dom.reportGeneratorModal);
}

// --- FUNÇÕES AUXILIARES DE CONFIGURAÇÃO ---

function setupModalCloseButtons() {
    const modalMap = {
        'close-modal-btn': dom.occurrenceModal,
        'cancel-btn': dom.occurrenceModal,
        'close-absence-modal-btn': dom.absenceModal,
        'cancel-absence-btn': dom.absenceModal,
        'close-report-generator-btn': dom.reportGeneratorModal,
        'cancel-report-generator-btn': dom.reportGeneratorModal,
        'close-notification-btn': dom.notificationModalBackdrop,
        'close-report-view-btn': dom.reportViewModalBackdrop,
        'close-ficha-view-btn': dom.fichaViewModalBackdrop,
        'close-history-view-btn': dom.historyViewModalBackdrop, // <-- Adicionado
        'close-students-modal-btn': dom.studentsModal,
        'cancel-delete-btn': dom.deleteConfirmModal
    };

    for (const [id, modal] of Object.entries(modalMap)) {
        const button = document.getElementById(id);
        if (button) {
            button.addEventListener('click', () => closeModal(modal));
        }
    }

    // Ações de Compartilhar e Imprimir
    document.getElementById('share-btn').addEventListener('click', () => shareContent(document.getElementById('notification-title').textContent, document.getElementById('notification-content').innerText));
    document.getElementById('report-share-btn').addEventListener('click', () => shareContent(document.getElementById('report-view-title').textContent, document.getElementById('report-view-content').innerText));
    document.getElementById('ficha-share-btn').addEventListener('click', () => shareContent(document.getElementById('ficha-view-title').textContent, document.getElementById('ficha-view-content').innerText));
    document.getElementById('print-btn').addEventListener('click', () => window.print());
    document.getElementById('report-print-btn').addEventListener('click', () => window.print());
    document.getElementById('ficha-print-btn').addEventListener('click', () => window.print());
}

// Configura a delegação de eventos para as listas dinâmicas
function setupListClickListeners() {
    dom.occurrencesListDiv.addEventListener('click', (e) => {
        const target = e.target;
        const button = target.closest('button');

        if (button) {
            e.stopPropagation();
            const id = button.dataset.id;
            
            if (button.classList.contains('edit-btn')) logic.handleEditOccurrence(id);
            else if (button.classList.contains('delete-btn')) logic.handleDelete('occurrence', id);
            else if (button.classList.contains('view-btn')) openNotificationModal(id);
            else if (button.classList.contains('history-btn')) openHistoryModal(id); // <-- Handler adicionado
            else if (button.classList.contains('generate-student-report-btn')) generateAndShowReport(button.dataset.studentId);
            
            return;
        }
        
        const newOccurrenceTrigger = target.closest('.new-occurrence-from-history-btn');
        if (newOccurrenceTrigger) {
             e.stopPropagation();
             logic.handleNewOccurrenceFromHistory(newOccurrenceTrigger.dataset.studentId);
             return;
        }

        const header = target.closest('.process-header');
        if (header) logic.toggleAccordion(header, 'occ');
    });

    dom.absencesListDiv.addEventListener('click', (e) => {
        const target = e.target;
        const button = target.closest('button');

        if (button) {
            e.stopPropagation();
            const id = button.dataset.id;
            
            if (button.classList.contains('edit-absence-btn')) logic.handleEditAbsence(id);
            else if (button.classList.contains('delete-absence-btn')) logic.handleDeleteAbsence(id);
            else if (button.classList.contains('notification-btn')) openFichaViewModal(id);
            else if (button.classList.contains('send-ct-btn')) logic.handleSendToCT(id);
            else if (button.classList.contains('view-oficio-btn')) logic.handleViewOficio(id);
            else if (button.classList.contains('generate-ficha-btn-row')) generateAndShowConsolidatedFicha(button.dataset.studentId, button.dataset.processId);
            
            return;
        }

        const newActionTrigger = target.closest('.new-action-from-history-btn');
        if (newActionTrigger) {
            e.stopPropagation();
            logic.handleNewAbsenceFromHistory(newActionTrigger.dataset.studentId);
            return;
        }
        
        const header = target.closest('.process-header');
        if (header) logic.toggleAccordion(header, '');
    });
}
