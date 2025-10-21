// =================================================================================
// ARQUIVO: main.js
// RESPONSABILIDADE: Ponto de entrada da aplicação. Orquestra todos os outros
// módulos, configura os listeners de eventos e a autenticação do usuário.
// ATUALIZAÇÃO GERAL: O fluxo de ocorrências foi reescrito para lidar com
// a criação/edição de incidentes coletivos, geração do `occurrenceGroupId`,
// lógica de status baseada no campo "Parecer" e os novos filtros.
// =================================================================================

// --- MÓDULOS IMPORTADOS ---

// Serviços do Firebase para autenticação e banco de dados
import { onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { onSnapshot, query, writeBatch, doc, setDoc, where, getDocs, collection } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Módulos internos da aplicação
import { auth, db } from './firebase.js';
import { state, dom } from './state.js';
import { showToast, closeModal, shareContent, openModal } from './utils.js';
import { loadStudents, getCollectionRef, addRecord, updateRecord, deleteRecord, getStudentsDocRef } from './firestore.js';
import { 
    render, 
    renderStudentsList, 
    openOccurrenceModal,
    handleNewAbsenceAction,
    setupAutocomplete,
    openNotificationModal,
    openHistoryModal,
    openFichaViewModal,
    generateAndShowConsolidatedFicha,
    generateAndShowOficio,
    openAbsenceModalForStudent,
    showLoginView,
    showRegisterView,
    resetStudentForm,
    toggleFamilyContactFields,
    toggleVisitContactFields,
    generateAndShowGeneralReport,
    getFilteredOccurrences
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
            
            dom.loginScreen.classList.add('hidden');
            dom.mainContent.classList.remove('hidden');
            dom.userProfile.classList.remove('hidden');
            
            try {
                await loadStudents();
                setupFirestoreListeners();
                render();
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
            
            dom.mainContent.classList.add('hidden');
            dom.userProfile.classList.add('hidden');
            dom.loginScreen.classList.remove('hidden');
            render();
        }
    });

    setupEventListeners();
    
    // Configura autocomplete apenas para a Busca Ativa, pois Ocorrências agora tem um botão dedicado.
    setupAutocomplete('search-absences', 'absence-student-suggestions', handleNewAbsenceAction);
});

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
    // Autenticação
    dom.loginForm.addEventListener('submit', handleLogin);
    dom.registerForm.addEventListener('submit', handleRegister);
    dom.logoutBtn.addEventListener('click', () => signOut(auth));
    dom.showRegisterViewBtn.addEventListener('click', showRegisterView);
    dom.showLoginViewBtn.addEventListener('click', showLoginView);
    
    // Navegação por Abas
    dom.tabOccurrences.addEventListener('click', () => switchTab('occurrences'));
    dom.tabAbsences.addEventListener('click', () => switchTab('absences'));

    // Submissão de Formulários
    dom.occurrenceForm.addEventListener('submit', handleOccurrenceSubmit);
    dom.absenceForm.addEventListener('submit', handleAbsenceSubmit);

    // Fechar Modais
    setupModalCloseButtons();

    // --- Ocorrências: Novos Listeners ---
    document.getElementById('add-occurrence-btn').addEventListener('click', () => openOccurrenceModal());
    dom.searchOccurrences.addEventListener('input', (e) => { state.filterOccurrences = e.target.value; render(); });
    dom.occurrenceStartDate.addEventListener('change', (e) => { state.filtersOccurrences.startDate = e.target.value; render(); });
    dom.occurrenceEndDate.addEventListener('change', (e) => { state.filtersOccurrences.endDate = e.target.value; render(); });
    document.getElementById('occurrence-filter-type').addEventListener('change', (e) => { state.filtersOccurrences.type = e.target.value; render(); });
    document.getElementById('occurrence-filter-status').addEventListener('change', (e) => { state.filtersOccurrences.status = e.target.value; render(); });
    dom.generalReportBtn.addEventListener('click', generateAndShowGeneralReport);

    // --- Busca Ativa: Listeners Originais ---
    document.getElementById('filter-process-status').addEventListener('change', (e) => { state.filtersAbsences.processStatus = e.target.value; render(); });
    document.getElementById('filter-pending-action').addEventListener('change', (e) => { state.filtersAbsences.pendingAction = e.target.value; render(); });
    document.getElementById('filter-return-status').addEventListener('change', (e) => { state.filtersAbsences.returnStatus = e.target.value; render(); });
    
    // Gerenciamento de Alunos
    document.getElementById('manage-students-btn').addEventListener('click', () => { renderStudentsList(); openModal(dom.studentsModal); });
    document.getElementById('upload-csv-btn').addEventListener('click', handleCsvUpload);
    document.getElementById('student-form').addEventListener('submit', handleStudentFormSubmit);
    document.getElementById('cancel-edit-student-btn').addEventListener('click', resetStudentForm);

    // Ações nas Listas
    setupListClickListeners();

    // Ações em Modais
    document.getElementById('confirm-delete-btn').addEventListener('click', handleDeleteConfirmation);
    document.getElementById('create-report-btn').addEventListener('click', handleReportGeneration);
    document.getElementById('action-type').addEventListener('change', (e) => handleActionTypeChange(e.target.value));
    document.querySelectorAll('input[name="contact-succeeded"]').forEach(radio => radio.addEventListener('change', (e) => toggleFamilyContactFields(e.target.value === 'yes', document.getElementById('family-contact-fields'))));
    document.querySelectorAll('input[name="visit-succeeded"]').forEach(radio => radio.addEventListener('change', (e) => toggleVisitContactFields(e.target.value === 'yes', document.getElementById('visit-contact-fields'))));
}

// --- HANDLERS E FUNÇÕES AUXILIARES ---

// Funções de Autenticação
async function handleLogin(e) {
    e.preventDefault();
    try {
        await signInWithEmailAndPassword(auth, document.getElementById('login-email').value, document.getElementById('login-password').value);
    } catch (error) {
        console.error("Erro de Login:", error);
        showToast("Email ou senha inválidos.");
    }
}

async function handleRegister(e) {
    e.preventDefault();
    try {
        await createUserWithEmailAndPassword(auth, document.getElementById('register-email').value, document.getElementById('register-password').value);
    } catch (error) {
        console.error("Erro de Registo:", error);
        showToast(getAuthErrorMessage(error.code));
    }
}

function getAuthErrorMessage(code) {
    switch (code) {
        case 'auth/email-already-in-use': return "Este email já está a ser utilizado.";
        case 'auth/weak-password': return "A sua senha é muito fraca.";
        default: return "Erro ao criar a conta.";
    }
}

// Navegação
function switchTab(tabName) {
    state.activeTab = tabName;
    const isOccurrences = tabName === 'occurrences';
    dom.tabOccurrences.classList.toggle('tab-active', isOccurrences);
    dom.tabAbsences.classList.toggle('tab-active', !isOccurrences);
    dom.tabContentOccurrences.classList.toggle('hidden', !isOccurrences);
    dom.tabContentAbsences.classList.toggle('hidden', isOccurrences);
    render();
}

// Submissão de Formulários
/**
 * REESCRITO: Lida com o salvamento de ocorrências (criação e edição).
 */
async function handleOccurrenceSubmit(e) {
    e.preventDefault();
    const groupId = document.getElementById('occurrence-group-id').value;
    
    if (state.selectedStudents.size === 0) {
        return showToast("Selecione pelo menos um aluno.");
    }
    
    const parecer = document.getElementById('occurrence-parecer').value.trim();
    const newStatus = parecer ? 'Finalizada' : 'Pendente';
    
    const data = { 
        date: document.getElementById('occurrence-date').value, 
        occurrenceType: document.getElementById('occurrence-type').value,
        status: newStatus,
        description: document.getElementById('description').value.trim(), 
        actionsTakenSchool: document.getElementById('actions-taken-school').value.trim(), 
        actionsTakenFamily: document.getElementById('actions-taken-family').value.trim(), 
        meetingDate: document.getElementById('meeting-date-occurrence').value || null, 
        meetingTime: document.getElementById('meeting-time-occurrence').value || null,
        parecer: parecer || null
    };

    try { 
        if (groupId) {
            // --- MODO DE EDIÇÃO ---
            const originalIncident = getFilteredOccurrences().get(groupId);
            if (!originalIncident) throw new Error("Incidente original não encontrado.");

            const historyAction = getOccurrenceHistoryMessage(originalIncident.records[0], data);
            
            const batch = writeBatch(db);
            const studentIdsInvolved = [...state.selectedStudents.keys()];

            // Atualiza ou cria registros para os alunos selecionados
            for (const studentId of studentIdsInvolved) {
                const existingRecord = originalIncident.records.find(r => r.studentId === studentId);
                const recordData = { ...data, studentId, occurrenceGroupId: groupId };

                if (existingRecord) {
                    const recordRef = doc(getCollectionRef('occurrence'), existingRecord.id);
                    batch.update(recordRef, recordData);
                } else {
                    const newRecordRef = doc(collection(db, getCollectionRef('occurrence').path));
                    batch.set(newRecordRef, { ...recordData, history: originalIncident.records[0].history || [] });
                }
            }

            // Deleta registros de alunos que foram removidos
            const originalStudentIds = originalIncident.records.map(r => r.studentId);
            const removedStudentIds = originalStudentIds.filter(id => !studentIdsInvolved.includes(id));
            for (const studentId of removedStudentIds) {
                const recordToDelete = originalIncident.records.find(r => r.studentId === studentId);
                if (recordToDelete) {
                    batch.delete(doc(getCollectionRef('occurrence'), recordToDelete.id));
                }
            }
            
            // Adiciona a ação ao histórico de todos os registros que permanecerão
            const recordsToUpdateHistory = await getDocs(query(getCollectionRef('occurrence'), where('occurrenceGroupId', '==', groupId)));
            recordsToUpdateHistory.docs.forEach(docSnapshot => {
                 if (studentIdsInvolved.includes(docSnapshot.data().studentId)) {
                    const newHistoryEntry = { action: historyAction, user: state.userEmail, timestamp: new Date() };
                    const currentHistory = docSnapshot.data().history || [];
                    batch.update(docSnapshot.ref, { history: [...currentHistory, newHistoryEntry] });
                 }
            });


            await batch.commit();
            showToast('Ocorrência atualizada com sucesso!');
        } else {
            // --- MODO DE CRIAÇÃO ---
            const newGroupId = `OCC-${Date.now()}`;
            const batch = writeBatch(db);
            
            const newHistoryEntry = {
                action: 'Incidente registado',
                user: state.userEmail,
                timestamp: new Date()
            };

            for (const studentId of state.selectedStudents.keys()) {
                const newRecordRef = doc(collection(getCollectionRef('occurrence')));
                const recordData = { ...data, studentId, occurrenceGroupId: newGroupId, history: [newHistoryEntry] };
                batch.set(newRecordRef, recordData);
            }
            await batch.commit();
            showToast('Ocorrência registada com sucesso!'); 
        }
        closeModal(dom.occurrenceModal); 
    } catch (error) { 
        console.error("Erro ao salvar ocorrência:", error);
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
    
    const data = getAbsenceFormData();
    if (!data) return;

    try {
        const id = data.id;
        delete data.id;

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

// Funções de Gerenciamento de Alunos
function handleCsvUpload() {
    const fileInput = document.getElementById('csv-file');
    const feedbackDiv = document.getElementById('csv-feedback');
    if (fileInput.files.length === 0) return showToast("Por favor, selecione um ficheiro CSV.");
    
    Papa.parse(fileInput.files[0], {
        header: true,
        skipEmptyLines: true,
        transformHeader: header => header.toLowerCase().trim().replace(/\s+/g, ''),
        complete: async (results) => {
            const requiredHeaders = ['matricula', 'nome', 'turma', 'endereco', 'contato', 'resp1', 'resp2'];
            const hasAllHeaders = requiredHeaders.every(h => results.meta.fields.includes(h));
            if (!hasAllHeaders) {
                feedbackDiv.innerHTML = `<p class="text-red-500">Erro: Faltam colunas. O ficheiro CSV deve conter: ${requiredHeaders.join(', ')}.</p>`;
                return;
            }

            const newStudentList = results.data.map(row => ({
                matricula: row.matricula || '', name: row.nome || '', class: row.turma || '',
                endereco: row.endereco || '', contato: row.contato || '',
                resp1: row.resp1 || '', resp2: row.resp2 || ''
            })).filter(s => s.name && s.matricula);

            try {
                await setDoc(getStudentsDocRef(), { list: newStudentList });
                state.students = newStudentList;
                renderStudentsList();
                showToast(`${newStudentList.length} alunos importados com sucesso!`);
                fileInput.value = '';
                feedbackDiv.innerHTML = '';
            } catch(error) {
                showToast("Erro ao salvar a nova lista de alunos.");
            }
        }
    });
}

async function handleStudentFormSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('student-id-input').value;
    const matricula = document.getElementById('student-matricula-input').value.trim();
    const name = document.getElementById('student-name-input').value.trim();
    if (!matricula || !name) return showToast("Matrícula e Nome são obrigatórios.");
    
    let updatedList = [...state.students];
    const studentData = { 
        matricula, name, 
        class: document.getElementById('student-class-input').value.trim(),
        endereco: document.getElementById('student-endereco-input').value.trim(),
        contato: document.getElementById('student-contato-input').value.trim(),
        resp1: document.getElementById('student-resp1-input').value.trim(),
        resp2: document.getElementById('student-resp2-input').value.trim()
    };
    
    if (id) {
        const index = updatedList.findIndex(s => s.matricula === id);
        if (index > -1) updatedList[index] = studentData;
    } else {
        if (updatedList.some(s => s.matricula === matricula)) return showToast("Erro: Matrícula já existe.");
        updatedList.push(studentData);
    }

    try {
        await setDoc(getStudentsDocRef(), { list: updatedList });
        state.students = updatedList;
        renderStudentsList();
        resetStudentForm();
        showToast(`Aluno ${id ? 'atualizado' : 'adicionado'} com sucesso.`);
    } catch(error) {
        showToast("Erro ao salvar dados do aluno.");
    }
}

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
        // A lógica de relatório de ocorrência individual foi removida,
        // pois o Relatório Geral agora pode ser filtrado por aluno.
        showToast("Use o Relatório Geral e o filtro de aluno para gerar relatórios individuais.");
    } else {
        generateAndShowConsolidatedFicha(studentId);
    }
    closeModal(dom.reportGeneratorModal);
}

// Lógica de UI e Dados
function getOccurrenceHistoryMessage(original, updated) {
    if (original && original.status !== updated.status) {
        return `Status alterado de "${original.status}" para "${updated.status}".`;
    }
    if (original && original.parecer !== updated.parecer && updated.parecer) {
        return `Parecer adicionado/atualizado.`;
    }
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
        'close-report-view-btn': dom.reportViewModalBackdrop,
        'close-ficha-view-btn': dom.fichaViewModalBackdrop,
        'close-history-view-btn': document.getElementById('history-view-modal-backdrop'),
        'close-students-modal-btn': dom.studentsModal,
        'cancel-delete-btn': dom.deleteConfirmModal
    };

    for (const [id, modal] of Object.entries(modalMap)) {
        const button = document.getElementById(id);
        if (button && modal) {
            button.addEventListener('click', () => closeModal(modal));
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
    dom.occurrencesListDiv.addEventListener('click', (e) => {
        const button = e.target.closest('button');
        if (button) {
            e.stopPropagation();
            const groupId = button.dataset.groupId;
            if (button.classList.contains('edit-btn')) handleEditOccurrence(groupId);
            else if (button.classList.contains('delete-btn')) handleDelete('occurrence', groupId);
            else if (button.classList.contains('view-btn')) openNotificationModal(groupId);
            else if (button.classList.contains('history-btn')) openHistoryModal(groupId);
        }
    });

    dom.absencesListDiv.addEventListener('click', (e) => {
        const button = e.target.closest('button');
        if (button) {
            e.stopPropagation();
            const id = button.dataset.id;
            if (button.classList.contains('edit-absence-btn')) handleEditAbsence(id);
            else if (button.classList.contains('delete-absence-btn')) handleDeleteAbsence(id);
            else if (button.classList.contains('notification-btn')) openFichaViewModal(id);
            else if (button.classList.contains('send-ct-btn')) handleSendToCT(id);
            else if (button.classList.contains('view-oficio-btn')) handleViewOficio(id);
            else if (button.classList.contains('generate-ficha-btn-row')) generateAndShowConsolidatedFicha(button.dataset.studentId, button.dataset.processId);
            return;
        }

        const newActionTrigger = e.target.closest('.new-action-from-history-btn');
        if (newActionTrigger) {
            e.stopPropagation();
            handleNewAbsenceFromHistory(newActionTrigger.dataset.studentId);
            return;
        }
        
        const header = e.target.closest('.process-header');
        if (header) toggleAccordion(header);
    });
}

// Funções de Manipulação de Eventos das Listas
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
                await addRecord('absence', dataForCt, state.userEmail);
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

function toggleAccordion(header) {
    const id = header.dataset.processId;
    const content = document.getElementById(`content-${id}`);
    const icon = header.querySelector('i.fa-chevron-down');
    if (content) {
        const isHidden = !content.style.maxHeight || content.style.maxHeight === '0px';
        content.style.maxHeight = isHidden ? `${content.scrollHeight}px` : null;
        icon?.classList.toggle('rotate-180', isHidden);
    }
}

