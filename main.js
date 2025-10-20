// ARQUIVO: main.js
// RESPONSABILIDADE: Ponto de entrada da aplicação. Orquestra todos os outros
// módulos, configura os listeners de eventos e a autenticação do usuário.

// --- Importações dos Módulos ---
import { onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { onSnapshot, query, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

import { auth, db } from './firebase.js';
import { state, dom } from './state.js';
import { showToast, closeModal, shareContent, openModal } from './utils.js';
import { loadStudents, getCollectionRef, addRecord, updateRecord, updateOccurrenceRecord, deleteRecord, getStudentsDocRef } from './firestore.js';
import { 
    render, 
    renderStudentsList, 
    openOccurrenceModalForStudent,
    setupAutocomplete,
    showLoginView,
    showRegisterView,
    resetStudentForm,
    openOccurrenceEditorModal,
    handleDeleteOccurrenceClick,
    showOccurrenceRecord,
    showNotificationResponsible,
    openAbsenceModalForStudent,
    handleNewAbsenceAction,
    generateAndShowConsolidatedFicha,
    generateAndShowOficio,
    openFichaViewModal
} from './ui.js';


// ==============================================================================
// SEÇÃO 1: INICIALIZAÇÃO E AUTENTICAÇÃO
// ==============================================================================

document.addEventListener('DOMContentLoaded', () => {
    state.db = db;
    
    onAuthStateChanged(auth, async user => {
        detachFirestoreListeners();
        if (user) {
            state.userId = user.uid;
            dom.userEmail.textContent = user.email || `Utilizador: ${user.uid.substring(0, 8)}`;
            dom.loginScreen.classList.add('hidden');
            dom.mainContent.classList.remove('hidden');
            dom.userProfile.classList.remove('hidden');
            try {
                await loadStudents();
                renderStudentsList();
                setupFirestoreListeners();
            } catch (error) {
                showToast(error.message);
            }
        } else {
            state.userId = null;
            state.students = []; state.occurrences = []; state.absences = [];
            render();
            dom.mainContent.classList.add('hidden');
            dom.userProfile.classList.add('hidden');
            dom.loginScreen.classList.remove('hidden');
        }
    });

    //
    // --- CORREÇÃO: Lógica de Login/Registo restaurada para a versão original e robusta ---
    //
    dom.loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        try {
            await signInWithEmailAndPassword(auth, email, password);
        } catch (error) {
            console.error("Erro ao entrar:", error.code);
            showToast("Email ou senha inválidos.");
        }
    });

    dom.registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('register-email').value;
        const password = document.getElementById('register-password').value;
        try {
            await createUserWithEmailAndPassword(auth, email, password);
        } catch (error) {
            console.error("Erro ao registar:", error.code);
            const message = error.code === 'auth/email-already-in-use' ? "Este email já está a ser utilizado."
                          : error.code === 'auth/weak-password' ? "A sua senha é muito fraca."
                          : "Erro ao criar a conta.";
            showToast(message);
        }
    });

    dom.logoutBtn.addEventListener('click', () => signOut(auth));
    dom.showRegisterViewBtn.addEventListener('click', showRegisterView);
    dom.showLoginViewBtn.addEventListener('click', showLoginView);

    setupEventListeners();
    setupAutocomplete('search-occurrences', 'occurrence-student-suggestions', openOccurrenceModalForStudent); 
    setupAutocomplete('search-absences', 'absence-student-suggestions', handleNewAbsenceAction);
});


// ==============================================================================
// SEÇÃO 2: LISTENERS DO FIRESTORE (TEMPO REAL)
// ==============================================================================

function setupFirestoreListeners() {
    if (!state.userId) return;

    if (state.unsubscribeOccurrences) state.unsubscribeOccurrences();
    const occurrencesQuery = query(getCollectionRef('occurrence'));
    state.unsubscribeOccurrences = onSnapshot(occurrencesQuery, (snapshot) => {
        state.occurrences = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (state.activeTab === 'occurrences') render();
    }, (error) => console.error("Erro ao buscar ocorrências:", error));

    if (state.unsubscribeAbsences) state.unsubscribeAbsences();
    const absencesQuery = query(getCollectionRef('absence'));
    state.unsubscribeAbsences = onSnapshot(absencesQuery, (snapshot) => {
        state.absences = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (state.activeTab === 'absences') render();
    }, (error) => console.error("Erro ao buscar ações de busca ativa:", error));
};

function detachFirestoreListeners() {
    if (state.unsubscribeOccurrences) state.unsubscribeOccurrences();
    if (state.unsubscribeAbsences) state.unsubscribeAbsences();
    state.unsubscribeOccurrences = null;
    state.unsubscribeAbsences = null;
};


// ==============================================================================
// SEÇÃO 3: CONFIGURAÇÃO DE EVENTOS GERAIS DA UI
// ==============================================================================

function setupEventListeners() {
    // --- Navegação por Abas ---
    dom.tabOccurrences.addEventListener('click', () => {
        state.activeTab = 'occurrences';
        dom.tabOccurrences.classList.add('tab-active');
        dom.tabAbsences.classList.remove('tab-active');
        dom.tabContentOccurrences.classList.remove('hidden');
        dom.tabContentAbsences.classList.add('hidden');
        render();
    });
    dom.tabAbsences.addEventListener('click', () => {
        state.activeTab = 'absences';
        dom.tabAbsences.classList.add('tab-active');
        dom.tabOccurrences.classList.remove('tab-active');
        dom.tabContentAbsences.classList.remove('hidden');
        dom.tabContentOccurrences.classList.add('hidden');
        render();
    });

    // --- Fechamento de Modais ---
    document.getElementById('close-modal-btn')?.addEventListener('click', () => closeModal(dom.occurrenceModal));
    document.getElementById('cancel-btn')?.addEventListener('click', () => closeModal(dom.occurrenceModal));
    document.getElementById('close-students-modal-btn')?.addEventListener('click', () => closeModal(dom.studentsModal));
    document.getElementById('cancel-delete-btn')?.addEventListener('click', () => closeModal(dom.deleteConfirmModal));
    document.getElementById('close-occurrence-record-btn')?.addEventListener('click', () => closeModal(dom.occurrenceRecordModalBackdrop));
    document.getElementById('close-notification-responsible-btn')?.addEventListener('click', () => closeModal(dom.notificationResponsibleModalBackdrop));
    
    // --- Filtros de Ocorrências ---
    dom.filterOccurrenceType.addEventListener('change', (e) => { state.filtersOccurrences.type = e.target.value; render(); });
    dom.filterOccurrenceStatus.addEventListener('change', (e) => { state.filtersOccurrences.status = e.target.value; render(); });
    dom.occurrenceStartDate.addEventListener('change', (e) => { state.filtersOccurrences.startDate = e.target.value; render(); });
    dom.occurrenceEndDate.addEventListener('change', (e) => { state.filtersOccurrences.endDate = e.target.value; render(); });

    // --- Formulário de Ocorrência com Novo Fluxo ---
    dom.occurrenceForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('occurrence-id').value;
        const student = state.students.find(s => s.name === document.getElementById('student-name').value.trim());
        if (!student) return showToast("Aluno inválido.");
        
        const data = { 
            studentId: student.matricula,
            date: document.getElementById('occurrence-date').value, 
            occurrenceType: document.getElementById('occurrence-type').value,
            description: document.getElementById('description').value.trim(), 
            involved: document.getElementById('involved').value.trim(), 
            actionsTakenSchool: document.getElementById('actions-taken-school').value.trim(), 
            actionsTakenFamily: document.getElementById('actions-taken-family').value.trim(), 
            meetingDate: document.getElementById('meeting-date-occurrence').value || null, 
            meetingTime: document.getElementById('meeting-time-occurrence').value || null
        };

        try { 
            if (id) {
                await updateRecord('occurrence', id, data);
                await updateOccurrenceRecord(id, {}, "Registro editado");
                showToast('Ocorrência atualizada com sucesso!');
                closeModal(dom.occurrenceModal);
            } else {
                const docRef = await addRecord('occurrence', data);
                state.lastSavedOccurrenceId = docRef.id;
                showToast('Ocorrência registada com sucesso!');
                closeModal(dom.occurrenceModal);
                openModal(dom.postSaveActionsModal);
            }
        } catch (error) { console.error("Erro ao salvar:", error); showToast('Erro ao salvar.'); }
    });

    // --- Listeners para o Modal de Ações Rápidas ---
    document.getElementById('action-print-record').addEventListener('click', async () => {
        const id = state.lastSavedOccurrenceId;
        if (!id) return;
        showOccurrenceRecord(id);
        await updateOccurrenceRecord(id, {}, "Ata para arquivo impressa");
        closeModal(dom.postSaveActionsModal);
    });
    document.getElementById('action-generate-notification').addEventListener('click', async () => {
        const id = state.lastSavedOccurrenceId;
        if (!id) return;
        showNotificationResponsible(id);
        await updateOccurrenceRecord(id, { status: 'Aguardando Assinatura' }, "Notificação gerada para responsável");
        closeModal(dom.postSaveActionsModal);
    });
    document.getElementById('action-close').addEventListener('click', () => closeModal(dom.postSaveActionsModal));

    // --- Listeners para os Modais de Documentos ---
    document.getElementById('print-record-btn').addEventListener('click', () => window.print());
    document.getElementById('print-notification-btn').addEventListener('click', () => window.print());
    document.getElementById('share-notification-btn').addEventListener('click', () => {
        const occurrenceId = state.lastSavedOccurrenceId || document.querySelector('#notification-responsible-modal-backdrop[data-id]')?.dataset.id;
        const occ = state.occurrences.find(o => o.id === occurrenceId);
        if (occ) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = generateNotificationResponsibleHTML(occ);
            const textContent = tempDiv.innerText || tempDiv.textContent || '';
            shareContent('Notificação de Ocorrência', textContent);
        }
    });

    // --- Listener para o botão de Excluir (confirmação) ---
    document.getElementById('confirm-delete-btn').addEventListener('click', async () => {
        if (!state.recordToDelete) return;
        try {
            await deleteRecord(state.recordToDelete.type, state.recordToDelete.id);
            showToast('Registro excluído com sucesso.');
        } catch (error) {
            showToast('Erro ao excluir.');
        } finally {
            state.recordToDelete = null;
            closeModal(dom.deleteConfirmModal);
        }
    });

    // --- Gestão de Alunos ---
    document.getElementById('manage-students-btn').addEventListener('click', () => { renderStudentsList(); openModal(dom.studentsModal); });
    document.getElementById('student-form').addEventListener('submit', async (e) => {
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
    });
    document.getElementById('cancel-edit-student-btn').addEventListener('click', resetStudentForm);

    setupListClickListeners();
};


// ==============================================================================
// SEÇÃO 4: LISTENER CENTRALIZADO PARA CLIQUES NAS LISTAS
// ==============================================================================

function setupListClickListeners() {
    
    dom.occurrencesListDiv.addEventListener('click', async (e) => {
        const target = e.target;
        
        const header = target.closest('.process-header');
        if (header && !target.closest('[data-action]')) {
            const id = header.dataset.occurrenceId;
            const content = document.getElementById(`content-occ-${id}`);
            const icon = header.querySelector('i.fa-chevron-down');
            if (content) {
                const isHidden = !content.style.maxHeight || content.style.maxHeight === '0px';
                content.style.maxHeight = isHidden ? `${content.scrollHeight}px` : null;
                icon?.classList.toggle('rotate-180', isHidden);
            }
            return;
        }

        const actionTarget = target.closest('[data-action]');
        if (actionTarget) {
            e.preventDefault();
            e.stopPropagation();

            const { action, id, status } = actionTarget.dataset;
            
            if (action !== 'toggle-menu') {
                document.querySelectorAll('[id^="menu-"]').forEach(menu => menu.classList.add('hidden'));
            }

            switch (action) {
                case 'print-record':
                    showOccurrenceRecord(id);
                    await updateOccurrenceRecord(id, {}, "Ata para arquivo impressa");
                    break;
                case 'generate-notification':
                    state.lastSavedOccurrenceId = id;
                    document.querySelector('#notification-responsible-modal-backdrop').dataset.id = id;
                    showNotificationResponsible(id);
                    await updateOccurrenceRecord(id, { status: 'Aguardando Assinatura' }, "Notificação gerada para responsável");
                    break;
                case 'toggle-menu':
                    const menu = document.getElementById(`menu-${id}`);
                    menu?.classList.toggle('hidden');
                    break;
                case 'edit':
                    openOccurrenceEditorModal(id);
                    break;
                case 'delete':
                    handleDeleteOccurrenceClick(id);
                    break;
                case 'set-status':
                    try {
                        await updateOccurrenceRecord(id, { status: status }, `Status alterado para "${status}"`);
                        showToast(`Status atualizado para "${status}"!`);
                    } catch {
                        showToast("Erro ao atualizar status.");
                    }
                    break;
            }
        }
    });

    dom.absencesListDiv.addEventListener('click', (e) => {
        const target = e.target;
        const header = target.closest('.process-header');
        const button = target.closest('button');

        if (button) {
            e.stopPropagation();
            const id = button.dataset.id;
            
            if (button.classList.contains('edit-absence-btn')) {
                const data = state.absences.find(a => a.id === id);
                const student = data ? state.students.find(s => s.matricula === data.studentId) : null;
                if (student) openAbsenceModalForStudent(student, data.actionType, data);

            } else if (button.classList.contains('delete-absence-btn')) {
                const actionToDelete = state.absences.find(a => a.id === id);
                if (!actionToDelete) return;

                const sequence = ['tentativa_1', 'tentativa_2', 'tentativa_3', 'visita', 'encaminhamento_ct', 'analise'];
                const processActions = state.absences.filter(a => a.processId === actionToDelete.processId);
                const deleteIndex = sequence.indexOf(actionToDelete.actionType);
                const hasLaterAction = processActions.some(a => sequence.indexOf(a.actionType) > deleteIndex);

                if (hasLaterAction) return showToast("Exclua a etapa mais recente do processo primeiro.");
                
                state.recordToDelete = { type: 'absence', id: id };
                openModal(dom.deleteConfirmModal);

            } else if (button.classList.contains('notification-btn')) {
                openFichaViewModal(id);
            } else if (button.classList.contains('send-ct-btn')) {
                const oficioNumber = prompt("Por favor, insira o número do ofício:");
                if (oficioNumber?.trim()) {
                    const visitAction = state.absences.find(a => a.id === id);
                    if (visitAction) {
                        generateAndShowOficio(visitAction, oficioNumber);
                    }
                }
            } else if (button.classList.contains('view-oficio-btn')) {
                const ctAction = state.absences.find(a => a.id === id);
                if (ctAction) generateAndShowOficio(ctAction);
            } else if (button.classList.contains('generate-ficha-btn-row')) {
                generateAndShowConsolidatedFicha(button.dataset.studentId, button.dataset.processId);
            }
            return;
        }

        const newActionTrigger = target.closest('.new-action-from-history-btn');
        if (newActionTrigger) {
            e.stopPropagation();
            const studentId = newActionTrigger.dataset.studentId;
            const student = state.students.find(s => s.matricula === studentId);
            if (student) handleNewAbsenceAction(student);
            return;
        }

        if (header) {
            const processId = header.dataset.processId;
            const content = document.getElementById(`content-${processId}`);
            const icon = header.querySelector('i.fa-chevron-down');
            if (content) {
                const isHidden = !content.style.maxHeight || content.style.maxHeight === '0px';
                content.style.maxHeight = isHidden ? `${content.scrollHeight}px` : null;
                icon?.classList.toggle('rotate-180', isHidden);
            }
        }
    });
}

