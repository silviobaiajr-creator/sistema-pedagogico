// ARQUIVO: main.js
// Responsabilidade: Ponto de entrada. Orquestra todos os outros módulos.
// Configura os listeners de eventos e a autenticação.

// Importações dos Serviços do Firebase
import { onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { onSnapshot, query, writeBatch, doc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Importações dos nossos módulos
import { auth, db } from './firebase.js';
import { state, dom } from './state.js';
import { showToast, closeModal, shareContent } from './utils.js';
import { loadStudents, getCollectionRef, addRecord, updateRecord, deleteRecord, getStudentsDocRef } from './firestore.js';
import { 
    render, 
    renderStudentsList, 
    openOccurrenceModalForStudent,
    handleNewAbsenceAction,
    setupAutocomplete,
    openNotificationModal,
    openFichaViewModal,
    generateAndShowReport,
    generateAndShowConsolidatedFicha,
    generateAndShowOficio,
    openAbsenceModalForStudent,
    openReportGeneratorModal,
    showLoginView,
    showRegisterView,
    resetStudentForm,
    toggleFamilyContactFields,
    toggleVisitContactFields
} from './ui.js';
import { setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import * as logic from './logic.js';


// --- INICIALIZAÇÃO ---
document.addEventListener('DOMContentLoaded', () => {
    
    // Injeta o 'db' no state, pois é usado por 'getCollectionRef' que é chamado por listeners
    state.db = db;

    // --- LÓGICA DE AUTENTICAÇÃO ---
    onAuthStateChanged(auth, async user => {
        detachFirestoreListeners();
        if (user) {
            state.userId = user.uid;
            dom.userEmail.textContent = user.email || `Utilizador: ${user.uid.substring(0, 8)}`;
            dom.loginScreen.classList.add('hidden');
            dom.mainContent.classList.remove('hidden');
            dom.userProfile.classList.remove('hidden');
            
            try {
                await loadStudents(); // Carrega os alunos primeiro
                renderStudentsList(); // Renderiza a lista de alunos (para os autocompletes funcionarem)
                setupFirestoreListeners(); // Agora liga os listeners de ocorrências/ausências
            } catch (error) {
                showToast(error.message);
            }

        } else {
            // Limpa o estado ao deslogar
            state.userId = null;
            state.students = [];
            state.occurrences = [];
            state.absences = [];
            render();
            dom.mainContent.classList.add('hidden');
            dom.userProfile.classList.add('hidden');
            dom.loginScreen.classList.remove('hidden');
        }
    });

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
            if (error.code === 'auth/email-already-in-use') {
                showToast("Este email já está a ser utilizado.");
            } else if (error.code === 'auth/weak-password') {
                showToast("A sua senha é muito fraca.");
            } else {
                showToast("Erro ao criar a conta.");
            }
        }
    });

    dom.logoutBtn.addEventListener('click', async () => {
        try {
            await signOut(auth);
        } catch (error) {
            console.error("Erro ao sair:", error);
        }
    });

    // Configura todos os listeners de botões, formulários, etc.
    setupEventListeners();
    
    // Configura os autocompletes
    setupAutocomplete('search-occurrences', 'occurrence-student-suggestions', (student) => {
        openOccurrenceModalForStudent(student);
    }); 
    setupAutocomplete('search-absences', 'absence-student-suggestions', (student) => {
        handleNewAbsenceAction(student);
    });
});


// --- LISTENERS DO FIREBASE ---
// (Estão aqui para que possam chamar 'render' da 'ui.js' sem dependência circular)
function setupFirestoreListeners() {
    if (!state.userId) return;

    if (state.unsubscribeOccurrences) state.unsubscribeOccurrences();
    state.unsubscribeOccurrences = onSnapshot(query(getCollectionRef('occurrence')), (snapshot) => {
        state.occurrences = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (state.activeTab === 'occurrences') render();
    }, (error) => console.error("Erro ao buscar ocorrências:", error));

    if (state.unsubscribeAbsences) state.unsubscribeAbsences();
    state.unsubscribeAbsences = onSnapshot(query(getCollectionRef('absence')), (snapshot) => {
        state.absences = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (state.activeTab === 'absences') render();
    }, (error) => console.error("Erro ao buscar ações:", error));
};

function detachFirestoreListeners() {
    if (state.unsubscribeOccurrences) {
        state.unsubscribeOccurrences();
        state.unsubscribeOccurrences = null;
    }
    if (state.unsubscribeAbsences) {
        state.unsubscribeAbsences();
        state.unsubscribeAbsences = null;
    }
};


// --- CONFIGURAÇÃO DE EVENTOS (CLICKS, SUBMITS) ---
function setupEventListeners() {
    // --- Navegação ---
    dom.showRegisterViewBtn.addEventListener('click', showRegisterView);
    dom.showLoginViewBtn.addEventListener('click', showLoginView);
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

    // --- Botões de Compartilhar e Imprimir ---
    document.getElementById('share-btn').addEventListener('click', () => {
        const title = document.getElementById('notification-title').textContent;
        const content = document.getElementById('notification-content').innerText;
        shareContent(title, content);
    });
    document.getElementById('report-share-btn').addEventListener('click', () => {
        const title = document.getElementById('report-view-title').textContent;
        const content = document.getElementById('report-view-content').innerText;
        shareContent(title, content);
    });
    document.getElementById('ficha-share-btn').addEventListener('click', () => {
        const title = document.getElementById('ficha-view-title').textContent;
        const content = document.getElementById('ficha-view-content').innerText;
        shareContent(title, content);
    });
    document.getElementById('print-btn').addEventListener('click', () => window.print());
    document.getElementById('report-print-btn').addEventListener('click', () => window.print());
    document.getElementById('ficha-print-btn').addEventListener('click', () => window.print());

    // --- Botões de Fechar Modais ---
    ['close-modal-btn', 'cancel-btn'].forEach(id => document.getElementById(id).addEventListener('click', () => closeModal(dom.occurrenceModal)));
    ['close-absence-modal-btn', 'cancel-absence-btn'].forEach(id => document.getElementById(id).addEventListener('click', () => closeModal(dom.absenceModal)));
    ['close-report-generator-btn', 'cancel-report-generator-btn'].forEach(id => document.getElementById(id).addEventListener('click', () => closeModal(dom.reportGeneratorModal)));
    document.getElementById('close-notification-btn').addEventListener('click', () => closeModal(dom.notificationModalBackdrop));
    document.getElementById('close-report-view-btn').addEventListener('click', () => closeModal(dom.reportViewModalBackdrop));
    document.getElementById('close-ficha-view-btn').addEventListener('click', () => closeModal(dom.fichaViewModalBackdrop));
    document.getElementById('cancel-delete-btn').addEventListener('click', () => closeModal(dom.deleteConfirmModal));

    // --- Filtros ---
    dom.occurrenceStartDate.addEventListener('change', (e) => {
        state.filtersOccurrences.startDate = e.target.value;
        render();
    });
    dom.occurrenceEndDate.addEventListener('change', (e) => {
        state.filtersOccurrences.endDate = e.target.value;
        render();
    });
    document.getElementById('filter-process-status').addEventListener('change', (e) => {
        state.filtersAbsences.processStatus = e.target.value;
        render();
    });
    document.getElementById('filter-pending-action').addEventListener('change', (e) => {
        state.filtersAbsences.pendingAction = e.target.value;
        render();
    });
    document.getElementById('filter-return-status').addEventListener('change', (e) => {
        state.filtersAbsences.returnStatus = e.target.value;
        render();
    });

    // --- Formulário de Ocorrência ---
    dom.occurrenceForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('occurrence-id').value;
        const studentName = document.getElementById('student-name').value.trim();
        const student = state.students.find(s => s.name === studentName);
        if (!student) {
            showToast("Aluno inválido. Por favor, selecione um aluno da lista.");
            return;
        }
        const data = { 
            studentId: student.matricula,
            date: document.getElementById('occurrence-date').value, 
            occurrenceType: document.getElementById('occurrence-type').value,
            description: document.getElementById('description').value.trim(), 
            involved: document.getElementById('involved').value.trim(), 
            actionsTakenSchool: document.getElementById('actions-taken-school').value.trim(), 
            actionsTakenFamily: document.getElementById('actions-taken-family').value.trim(), 
            meetingDate: document.getElementById('meeting-date-occurrence').value, 
            meetingTime: document.getElementById('meeting-time-occurrence').value 
        };
        try { 
            id ? await updateRecord('occurrence', id, data) : await addRecord('occurrence', data); 
            showToast(`Ocorrência ${id ? 'atualizada' : 'registada'} com sucesso!`); 
            closeModal(dom.occurrenceModal); 
        } catch (error) { console.error("Erro:", error); showToast('Erro ao salvar.'); }
    });

    // --- Formulário de Busca Ativa ---
    dom.absenceForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.target;
        if (!form.checkValidity()) {
            showToast('Por favor, preencha todos os campos obrigatórios.');
            form.reportValidity();
            return;
        }
        
        const id = document.getElementById('absence-id').value;
        const studentName = document.getElementById('absence-student-name').value.trim();
        const student = state.students.find(s => s.name === studentName);
        if (!student) {
            showToast("Aluno inválido. Por favor, selecione um aluno da lista.");
            return;
        }
        const actionType = document.getElementById('action-type').value;
        const processId = document.getElementById('absence-process-id').value;
        const data = { 
            studentId: student.matricula,
            actionType,
            processId
        };

        try {
            data.periodoFaltasStart = document.getElementById('absence-start-date').value || null;
            data.periodoFaltasEnd = document.getElementById('absence-end-date').value || null;
            data.absenceCount = document.getElementById('absence-count').value || null;

            switch (actionType) {
                case 'tentativa_1': case 'tentativa_2': case 'tentativa_3':
                    data.meetingDate = document.getElementById('meeting-date').value || null;
                    data.meetingTime = document.getElementById('meeting-time').value || null;
                    const contactSucceededRadio = document.querySelector('input[name="contact-succeeded"]:checked');
                    data.contactSucceeded = contactSucceededRadio ? contactSucceededRadio.value : null;
                    if (data.contactSucceeded === 'yes') {
                        data.contactDate = document.getElementById('contact-date').value || null;
                        data.contactPerson = document.getElementById('contact-person').value || null;
                        data.contactReason = document.getElementById('contact-reason').value || null;
                    }
                    const contactReturnedRadio = document.querySelector('input[name="contact-returned"]:checked');
                    data.contactReturned = contactReturnedRadio ? contactReturnedRadio.value : null;
                    break;
                case 'visita':
                    data.visitAgent = document.getElementById('visit-agent').value || null;
                    data.visitDate = document.getElementById('visit-date').value || null;
                    const visitSucceededRadio = document.querySelector('input[name="visit-succeeded"]:checked');
                    data.visitSucceeded = visitSucceededRadio ? visitSucceededRadio.value : null;
                     if (data.visitSucceeded === 'yes') {
                        data.visitContactPerson = document.getElementById('visit-contact-person').value || null;
                        data.visitReason = document.getElementById('visit-reason').value || null;
                        data.visitObs = document.getElementById('visit-obs').value || null;
                    }
                    const visitRadio = document.querySelector('input[name="visit-returned"]:checked');
                    data.visitReturned = visitRadio ? visitRadio.value : null;
                    break;
                case 'encaminhamento_ct':
                    data.ctSentDate = document.getElementById('ct-sent-date').value || null;
                    data.ctFeedback = document.getElementById('ct-feedback').value || null;
                    const ctRadio = document.querySelector('input[name="ct-returned"]:checked');
                    data.ctReturned = ctRadio ? ctRadio.value : null;
                    break;
                case 'analise':
                    data.ctParecer = document.getElementById('ct-parecer').value || null;
                    break;
            }
        } catch (error) {
            console.error("Erro ao recolher dados do formulário:", error);
            showToast("Erro interno ao ler os campos do formulário.");
            return;
        }

        try {
            const isNewRecord = !id;
            if (isNewRecord) {
                const newDocRef = await addRecord('absence', data);
                data.id = newDocRef.id;
                state.absences.push(data);
            } else {
                await updateRecord('absence', id, data);
            }
            
            showToast(`Ação ${id ? 'atualizada' : 'registada'} com sucesso!`);
            
            const studentReturned = (data.actionType.startsWith('tentativa') && data.contactReturned === 'yes') || (data.actionType === 'visita' && data.visitReturned === 'yes');

            closeModal(dom.absenceModal);

            if (studentReturned) {
                setTimeout(() => openAbsenceModalForStudent(student, 'analise'), 350);
            }

        } catch (error) { 
            console.error("Erro ao salvar ação:", error); 
            showToast('Erro ao salvar.'); 
        }
    });

    // --- Clicks na Lista de Busca Ativa ---
    dom.absencesListDiv.addEventListener('click', (e) => {
        const target = e.target;
        const header = target.closest('.process-header');
        const button = target.closest('button');
        const studentNameP = target.closest('.new-action-from-history-btn');

        if (studentNameP && !button) {
            e.stopPropagation();
            const studentId = studentNameP.dataset.studentId;
            const student = state.students.find(s => s.matricula === studentId);
            if (student) handleNewAbsenceAction(student);
            return;
        }

        if (header && !button) { 
            const processId = header.dataset.processId;
            const content = document.getElementById(`content-${processId}`);
            const icon = header.querySelector('i.fa-chevron-down');
            if (content) {
                if (content.style.maxHeight && content.style.maxHeight !== '0px') {
                    content.style.maxHeight = null;
                    icon.classList.remove('rotate-180');
                } else {
                    content.style.maxHeight = content.scrollHeight + "px";
                    icon.classList.add('rotate-180');
                }
            }
        }

        if(button) {
            const id = button.dataset.id;
            if (button.classList.contains('generate-ficha-btn-row')) {
                e.stopPropagation();
                const studentId = button.dataset.studentId;
                const processId = button.dataset.processId;
                generateAndShowConsolidatedFicha(studentId, processId);
                return; 
            }

            if (button.classList.contains('edit-absence-btn')) {
                const data = state.absences.find(a => a.id === id);
                const student = state.students.find(s => s.matricula === data.studentId);
                if (data && student) openAbsenceModalForStudent(student, data.actionType, data);
            }
            else if (button.classList.contains('delete-absence-btn')) { 
                const actionToDelete = state.absences.find(a => a.id === id);
                if (!actionToDelete) return;
                
                const sequence = ['tentativa_1', 'tentativa_2', 'tentativa_3', 'visita', 'encaminhamento_ct', 'analise'];
                const processActions = state.absences.filter(a => a.processId === actionToDelete.processId);
                const deleteIndex = sequence.indexOf(actionToDelete.actionType);
                const hasLaterAction = processActions.some(a => sequence.indexOf(a.actionType) > deleteIndex);

                if (hasLaterAction) {
                    showToast("Ação não pode ser excluída. Por favor, exclua a etapa mais recente deste processo primeiro.");
                    return;
                }

                if (actionToDelete.actionType === 'encaminhamento_ct') {
                     const analiseAction = processActions.find(a => a.actionType === 'analise');
                     document.getElementById('delete-confirm-message').textContent = 'Tem certeza? A etapa de Análise associada a este processo também será excluída. Esta ação não pode ser desfeita.';
                     state.recordToDelete = { type: 'absence-cascade', ctId: id, analiseId: analiseAction ? analiseAction.id : null };
                } else {
                     document.getElementById('delete-confirm-message').textContent = 'Tem certeza que deseja excluir este registro? Esta ação não pode ser desfeita.';
                     state.recordToDelete = { type: 'absence', id: id };
                }
                openModal(dom.deleteConfirmModal); 
            }
            else if (button.classList.contains('notification-btn')) { 
                openFichaViewModal(id);
            } 
            else if (button.classList.contains('send-ct-btn')) {
                const oficioNumber = prompt("Por favor, insira o número do ofício:");
                if (oficioNumber && oficioNumber.trim() !== '') {
                    const visitAction = state.absences.find(a => a.id === id);
                    if (!visitAction) return;

                    generateAndShowOficio(visitAction, oficioNumber); 

                    const student = state.students.find(s => s.matricula === visitAction.studentId);
                    if (!student) return;

                    const { processId, currentCycleActions } = logic.getStudentProcessInfo(student.matricula);
                    const alreadyExists = currentCycleActions.some(a => a.actionType === 'encaminhamento_ct');
                    if (alreadyExists) return;

                    const firstActionWithAbsenceData = currentCycleActions.find(a => a.periodoFaltasStart);
                    
                    const dataForCtAction = {
                        studentId: student.matricula,
                        actionType: 'encaminhamento_ct',
                        processId: processId,
                        ctSentDate: new Date().toISOString().split('T')[0],
                        oficioNumber: oficioNumber,
                        oficioYear: new Date().getFullYear(),
                        periodoFaltasStart: firstActionWithAbsenceData?.periodoFaltasStart || null,
                        periodoFaltasEnd: firstActionWithAbsenceData?.periodoFaltasEnd || null,
                        absenceCount: firstActionWithAbsenceData?.absenceCount || null,
                    };
                    
                    addRecord('absence', dataForCtAction).then(() => {
                        showToast("Registro de 'Encaminhamento ao CT' salvo automaticamente.");
                    }).catch(error => {
                        console.error("Erro ao salvar o encaminhamento ao CT:", error);
                        showToast("Erro ao salvar o encaminhamento automático.");
                    });
                }
            } 
            else if (button.classList.contains('view-oficio-btn')) {
                const ctAction = state.absences.find(a => a.id === id);
                if (ctAction) generateAndShowOficio(ctAction);
            }
        }
    });

    // --- Clicks na Lista de Ocorrências ---
    dom.occurrencesListDiv.addEventListener('click', (e) => {
        const target = e.target;
        const button = target.closest('button');
        const header = target.closest('.process-header');
        const studentNameSpan = target.closest('.new-occurrence-from-history-btn');

        if (studentNameSpan && !button) {
            e.stopPropagation();
            const studentId = studentNameSpan.dataset.studentId;
            const student = state.students.find(s => s.matricula === studentId);
            if (student) openOccurrenceModalForStudent(student);
            return;
        }
        
        if (header && !button && !target.closest('button')) { 
            const studentId = header.dataset.studentIdOcc;
            const content = document.getElementById(`content-occ-${studentId}`);
            const icon = header.querySelector('i.fa-chevron-down');
            if (content) {
                if (content.style.maxHeight && content.style.maxHeight !== '0px') {
                    content.style.maxHeight = null;
                    icon.classList.remove('rotate-180');
                } else {
                    content.style.maxHeight = content.scrollHeight + "px";
                    icon.classList.add('rotate-180');
                }
            }
            return;
        }

        if (button) {
            const studentId = button.dataset.studentId;
            if(button.classList.contains('generate-student-report-btn')){
                generateAndShowReport(studentId);
                return;
            }

            const id = button.dataset.id;
            if (button.classList.contains('edit-btn')) {
                const data = state.occurrences.find(o => o.id === id);
                const student = state.students.find(s => s.matricula === data.studentId);
                if (data && student) {
                    dom.occurrenceForm.reset();
                    document.getElementById('modal-title').innerText = 'Editar Registro de Ocorrência';
                    document.getElementById('occurrence-id').value = data.id || '';
                    document.getElementById('student-name').value = student.name || '';
                    document.getElementById('student-class').value = student.class || '';
                    document.getElementById('occurrence-type').value = data.occurrenceType || '';
                    document.getElementById('occurrence-date').value = data.date || '';
                    document.getElementById('description').value = data.description || '';
                    document.getElementById('involved').value = data.involved || '';
                    document.getElementById('actions-taken-school').value = data.actionsTakenSchool || '';
                    document.getElementById('actions-taken-family').value = data.actionsTakenFamily || '';
                    document.getElementById('meeting-date-occurrence').value = data.meetingDate || '';
                    document.getElementById('meeting-time-occurrence').value = data.meetingTime || '';
                    openModal(dom.occurrenceModal);
                }
            }
            else if (button.classList.contains('delete-btn')) { 
                document.getElementById('delete-confirm-message').textContent = 'Tem certeza que deseja excluir este registro? Esta ação não pode ser desfeita.';
                state.recordToDelete = { type: 'occurrence', id: id }; 
                openModal(dom.deleteConfirmModal);
            }
            else if (button.classList.contains('view-btn')) { 
                openNotificationModal(id); 
            }
        }
    });

    // --- Modal de Confirmação de Exclusão ---
    document.getElementById('confirm-delete-btn').addEventListener('click', async () => {
        if (state.recordToDelete) {
            try {
                if (state.recordToDelete.type === 'absence-cascade') {
                    const batch = writeBatch(db);
                    const ctRef = doc(getCollectionRef('absence'), state.recordToDelete.ctId);
                    batch.delete(ctRef);
                    if (state.recordToDelete.analiseId) {
                        const analiseRef = doc(getCollectionRef('absence'), state.recordToDelete.analiseId);
                        batch.delete(analiseRef);
                    }
                    await batch.commit();
                    showToast('Encaminhamento e Análise foram excluídos.');
                } else {
                    await deleteRecord(state.recordToDelete.type, state.recordToDelete.id);
                    showToast('Registro excluído com sucesso.');
                }
            } catch (error) {
                console.error("Erro ao excluir:", error);
                showToast('Erro ao excluir.');
            } finally {
                state.recordToDelete = null;
                closeModal(dom.deleteConfirmModal);
            }
        }
    });
    
    // --- Modal Gerador de Relatório ---
    document.getElementById('create-report-btn').addEventListener('click', () => {
        const selectedStudentId = document.getElementById('student-select').value;
        if (!selectedStudentId) return showToast('Por favor, selecione um aluno.');
        const reportType = dom.reportGeneratorModal.dataset.reportType;
        if (reportType === 'occurrences') generateAndShowReport(selectedStudentId);
        else generateAndShowConsolidatedFicha(selectedStudentId);
        closeModal(dom.reportGeneratorModal);
    });

    // --- Campos Dinâmicos do Modal de Busca Ativa ---
    document.getElementById('action-type').addEventListener('change', (e) => {
        const action = e.target.value;
        document.querySelectorAll('.dynamic-field-group').forEach(group => group.classList.add('hidden'));
        if (action.startsWith('tentativa')) {
            document.getElementById('group-tentativas').classList.remove('hidden');
        } else if (action === 'visita') {
            document.getElementById('group-visita').classList.remove('hidden');
        }
        else if (action) { 
            const group = document.getElementById(`group-${action}`); 
            if (group) group.classList.remove('hidden');
        }
    });
    document.querySelectorAll('input[name="contact-succeeded"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            toggleFamilyContactFields(e.target.value === 'yes', document.getElementById('family-contact-fields'));
        });
    });
    document.querySelectorAll('input[name="visit-succeeded"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            toggleVisitContactFields(e.target.value === 'yes', document.getElementById('visit-contact-fields'));
        });
    });

    // --- Modal de Gerenciamento de Alunos ---
    document.getElementById('manage-students-btn').addEventListener('click', () => {
        renderStudentsList();
        openModal(dom.studentsModal);
    });
    document.getElementById('close-students-modal-btn').addEventListener('click', () => closeModal(dom.studentsModal));
    
    // --- Upload de CSV ---
    document.getElementById('upload-csv-btn').addEventListener('click', async () => {
        const fileInput = document.getElementById('csv-file');
        const feedbackDiv = document.getElementById('csv-feedback');
        if (fileInput.files.length === 0) {
            showToast("Por favor, selecione um ficheiro CSV.");
            return;
        }
        
        Papa.parse(fileInput.files[0], {
            header: true,
            skipEmptyLines: true,
            transformHeader: header => header.toLowerCase().trim().replace(/\s+/g, ''),
            complete: async (results) => {
                const requiredHeaders = ['matricula', 'nome', 'turma', 'endereco', 'contato', 'resp1', 'resp2'];
                const fileHeaders = results.meta.fields;
                
                const hasAllHeaders = requiredHeaders.every(h => fileHeaders.includes(h));

                if (!hasAllHeaders) {
                    feedbackDiv.innerHTML = `<p class="text-red-500">Erro: Faltam colunas. O ficheiro CSV deve conter: matricula, nome, turma, endereco, contato, resp1, resp2.</p>`;
                    return;
                }

                const newStudentList = results.data.map(row => ({
                    matricula: row.matricula || '',
                    name: row.nome || '',
                    class: row.turma || '',
                    endereco: row.endereco || '',
                    contato: row.contato || '',
                    resp1: row.resp1 || '',
                    resp2: row.resp2 || ''
                })).filter(s => s.name && s.matricula);

                try {
                    await setDoc(getStudentsDocRef(), { list: newStudentList });
                    state.students = newStudentList;
                    renderStudentsList();
                    showToast(`${newStudentList.length} alunos importados com sucesso!`);
                    fileInput.value = '';
                    feedbackDiv.innerHTML = '';
                } catch(error) {
                    console.error("Erro ao salvar lista de alunos:", error);
                    showToast("Erro ao salvar a nova lista de alunos.");
                }
            }
        });
    });

    // --- Formulário de Aluno (Adicionar/Editar) ---
    document.getElementById('student-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('student-id-input').value; // Usando matricula como ID
        const matricula = document.getElementById('student-matricula-input').value.trim();
        const name = document.getElementById('student-name-input').value.trim();
        const studentClass = document.getElementById('student-class-input').value.trim();
        const endereco = document.getElementById('student-endereco-input').value.trim();
        const contato = document.getElementById('student-contato-input').value.trim();
        const resp1 = document.getElementById('student-resp1-input').value.trim();
        const resp2 = document.getElementById('student-resp2-input').value.trim();

        if (!matricula || !name || !studentClass || !resp1) {
            showToast("Matrícula, Nome, Turma e Responsável 1 são obrigatórios.");
            return;
        }
        
        const studentData = { matricula, name, class: studentClass, endereco, contato, resp1, resp2 };
        
        let updatedList = [...state.students];

        if (id) { // Editando
            const index = updatedList.findIndex(s => s.matricula === id);
            if (index > -1) {
                updatedList[index] = studentData;
            }
        } else { // Adicionando
            if (updatedList.some(s => s.matricula === matricula)) {
                showToast("Erro: Matrícula já existe.");
                return;
            }
            updatedList.push(studentData);
        }

        try {
            await setDoc(getStudentsDocRef(), { list: updatedList });
            state.students = updatedList;
            renderStudentsList();
            resetStudentForm();
            showToast(`Aluno ${id ? 'atualizado' : 'adicionado'} com sucesso.`);
        } catch(error) {
            console.error("Erro ao salvar aluno:", error);
            showToast("Erro ao salvar dados do aluno.");
        }
    });

    document.getElementById('cancel-edit-student-btn').addEventListener('click', resetStudentForm);
};
