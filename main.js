// =================================================================================
// ARQUIVO: main.js
// RESPONSABILIDADE: Ponto de entrada da aplicação. Orquestra a lógica de
// eventos, submissão de formulários e a comunicação entre a UI e o Firestore.
//
// ... (histórico anterior omitido para clareza) ...
//
// ATUALIZAÇÃO (REFATORAÇÃO occurrence.js):
// 1. Importado o novo módulo `initOccurrenceListeners`.
// 2. Removidas as importações de `openOccurrenceModal`, `openFollowUpModal`, `getFilteredOccurrences` (de ui.js).
// 3. Removidas as funções `handleOccurrenceSubmit`, `handleFollowUpSubmit`, `handleEditOccurrence`.
// 4. `setupEventListeners` agora chama `initOccurrenceListeners()`.
// 5. Ajustada a função `setupListClickListeners` para focar apenas em Busca Ativa.
// =================================================================================

// --- MÓDULOS IMPORTADOS ---

// Serviços do Firebase
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { onSnapshot, query, writeBatch, doc, setDoc, where, getDocs, collection, runTransaction } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Módulos internos da aplicação
import { auth, db } from './firebase.js';
import { state, dom, initializeDOMReferences } from './state.js';
import { showToast, closeModal, shareContent, openModal, loadScript } from './utils.js';
import { loadStudents, saveSchoolConfig, loadSchoolConfig, getCollectionRef, getStudentsDocRef, getCounterDocRef, updateRecordWithHistory, addRecordWithHistory, deleteRecord } from './firestore.js';

// Módulos de Funcionalidade
import { initAuthListeners } from './auth.js';
import { initSettingsListeners } from './settings.js';
import { initStudentListeners } from './students.js';
// <-- MUDANÇA: Importa o novo módulo de ocorrências
import { initOccurrenceListeners } from './occurrence.js';

// Funções de UI que *permaneceram* em ui.js
import {
    render,
    handleNewAbsenceAction, // Callback para autocomplete da Busca Ativa
    setupAutocomplete,
    openAbsenceModalForStudent, // Usado em handleAbsenceSubmit e handleEditAbsence
    toggleFamilyContactFields, // Usado nos listeners de radio
    toggleVisitContactFields, // Usado nos listeners de radio
    // <-- MUDANÇA: getFilteredOccurrences, (removido)
    // <-- MUDANÇA: openOccurrenceModal, (removido)
    // <-- MUDANÇA: openFollowUpModal, (removido)
} from './ui.js';

// Funções de relatório importadas de reports.js
import {
    // openStudentSelectionModal, // Chamado por occurrence.js agora
    // openOccurrenceRecordModal, // Chamado por occurrence.js agora
    // openHistoryModal, // Chamado por occurrence.js agora
    openAbsenceHistoryModal, // Ainda chamado aqui (Busca Ativa)
    openFichaViewModal, // Ainda chamado aqui (Busca Ativa)
    generateAndShowConsolidatedFicha, // Ainda chamado aqui (Busca Ativa)
    generateAndShowOficio, // Ainda chamado aqui (Busca Ativa)
    generateAndShowGeneralReport, // Ainda chamado aqui (Botão Geral Ocorrências)
    generateAndShowBuscaAtivaReport // Ainda chamado aqui (Botão Geral Busca Ativa)
} from './reports.js';

import * as logic from './logic.js'; // Usado em handleSendToCT

// --- INICIALIZAÇÃO DA APLICAÇÃO ---

document.addEventListener('DOMContentLoaded', () => {
    initializeDOMReferences();
    state.db = db;

    onAuthStateChanged(auth, async user => {
        detachFirestoreListeners();
        if (user) {
            state.userId = user.uid;
            state.userEmail = user.email;
            dom.userEmail.textContent = user.email || `Utilizador: ${user.uid.substring(0, 8)}`;
            dom.loginScreen.classList.add('hidden');
            dom.mainContent.classList.remove('hidden');
            dom.userProfile.classList.remove('hidden');
            try {
                await loadSchoolConfig();
                await loadStudents();
                dom.headerSchoolName.textContent = state.config.schoolName || 'Sistema de Acompanhamento';
                setupFirestoreListeners();
                render();
            } catch (error) {
                showToast(error.message);
            }
        } else {
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
    // Configura autocomplete apenas para a Busca Ativa (o de ocorrências está em occurrence.js agora).
    setupAutocomplete('search-absences', 'absence-student-suggestions', handleNewAbsenceAction);
});

// --- SINCRONIZAÇÃO COM O BANCO DE DADOS (FIRESTORE) ---

function setupFirestoreListeners() {
    if (!state.userId) return;

    const occurrencesQuery = query(getCollectionRef('occurrence'));
    state.unsubscribeOccurrences = onSnapshot(occurrencesQuery, (snapshot) => {
        state.occurrences = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        // Renderiza apenas se a aba ativa for a correta
        if (state.activeTab === 'occurrences') render();
    }, (error) => console.error("Erro ao buscar ocorrências:", error));

    const absencesQuery = query(getCollectionRef('absence'));
    state.unsubscribeAbsences = onSnapshot(absencesQuery, (snapshot) => {
        state.absences = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        // Renderiza apenas se a aba ativa for a correta
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
    initAuthListeners();
    dom.logoutBtn.addEventListener('click', () => signOut(auth));

    // Navegação por Abas
    dom.tabOccurrences.addEventListener('click', () => switchTab('occurrences'));
    dom.tabAbsences.addEventListener('click', () => switchTab('absences'));

    // Submissão de Formulários (exceto os movidos)
    // <-- MUDANÇA: occurrenceForm (removido, está em occurrence.js)
    dom.absenceForm.addEventListener('submit', handleAbsenceSubmit);
    // <-- MUDANÇA: followUpForm (removido, está em occurrence.js)

    // Fechar Modais (Genérico)
    setupModalCloseButtons();

    // --- Ocorrências: Listeners movidos para initOccurrenceListeners() ---
    // document.getElementById('add-occurrence-btn').addEventListener('click', ...);
    // dom.searchOccurrences.addEventListener('input', ...);
    // dom.occurrenceStartDate.addEventListener('change', ...);
    // dom.occurrenceEndDate.addEventListener('change', ...);
    // document.getElementById('occurrence-filter-type').addEventListener('change', ...);
    // document.getElementById('occurrence-filter-status').addEventListener('change', ...);
    dom.generalReportBtn.addEventListener('click', generateAndShowGeneralReport); // Botão geral ainda fica aqui

    // --- Busca Ativa: Listeners ---
    document.getElementById('general-ba-report-btn').addEventListener('click', generateAndShowBuscaAtivaReport); // Botão geral
    document.getElementById('filter-process-status').addEventListener('change', (e) => { state.filtersAbsences.processStatus = e.target.value; render(); });
    document.getElementById('filter-pending-action').addEventListener('change', (e) => { state.filtersAbsences.pendingAction = e.target.value; render(); });
    document.getElementById('filter-return-status').addEventListener('change', (e) => { state.filtersAbsences.returnStatus = e.target.value; render(); });

    // <-- MUDANÇA: Inicializa os módulos
    initSettingsListeners();
    initStudentListeners();
    initOccurrenceListeners(); // Chama o inicializador do novo módulo de ocorrências

    // <-- MUDANÇA: Ações nas Listas agora focada em Busca Ativa
    setupListClickListeners_Absences(); // Renomeada para clareza

    // Ações em Modais Genéricos
    document.getElementById('confirm-delete-btn').addEventListener('click', handleDeleteConfirmation); // Handler genérico
    // <-- MUDANÇA: action-type listener movido para absence.js
    // document.getElementById('action-type').addEventListener('change', ...);

    // Listeners para os rádios da Busca Ativa (ainda aqui)
    document.querySelectorAll('input[name="contact-succeeded"]').forEach(radio => radio.addEventListener('change', (e) => toggleFamilyContactFields(e.target.value === 'yes', document.getElementById('family-contact-fields'))));
    document.querySelectorAll('input[name="visit-succeeded"]').forEach(radio => radio.addEventListener('change', (e) => toggleVisitContactFields(e.target.value === 'yes', document.getElementById('visit-contact-fields'))));
    // Listener do radio do modal de FollowUp (ocorrências) também fica aqui, pois `toggleFamilyContactFields` é compartilhado
    document.querySelectorAll('input[name="follow-up-contact-succeeded"]').forEach(radio =>
        radio.addEventListener('change', (e) => {
            const enable = e.target.value === 'yes';
            toggleFamilyContactFields(enable, document.getElementById('follow-up-family-contact-fields'));
            // Lógica para tornar campo obrigatório (pode ser movida para occurrence.js se preferir)
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

    // Listener para fechar menus kebab (genérico)
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.kebab-menu-container')) {
            document.querySelectorAll('.kebab-menu-dropdown').forEach(d => d.classList.add('hidden'));
            // Restaura overflow dos acordeões abertos ao clicar fora
            document.querySelectorAll('.process-content').forEach(c => {
                if (c.style.maxHeight && c.style.maxHeight !== '0px') {
                    c.style.overflow = 'hidden';
                }
            });
        }
    });
}

// --- HANDLERS E FUNÇÕES AUXILIARES ---

function getFirestoreErrorMessage(code) {
    switch (code) {
        case 'permission-denied':
            return "Permissão negada. Verifique as suas credenciais.";
        case 'not-found':
            return "Documento não encontrado.";
        default:
            return "Ocorreu um erro na operação com a base de dados.";
    }
}


function switchTab(tabName) {
    state.activeTab = tabName;
    const isOccurrences = tabName === 'occurrences';
    dom.tabOccurrences.classList.toggle('tab-active', isOccurrences);
    dom.tabAbsences.classList.toggle('tab-active', !isOccurrences);
    dom.tabContentOccurrences.classList.toggle('hidden', !isOccurrences);
    dom.tabContentAbsences.classList.toggle('hidden', isOccurrences);
    render(); // Chama a renderização correta
}

// <-- MUDANÇA: Função movida para occurrence.js
// async function handleOccurrenceSubmit(e) { ... }

// <-- MUDANÇA: Função movida para occurrence.js
// async function handleFollowUpSubmit(e) { ... }


async function handleAbsenceSubmit(e) {
    e.preventDefault();
    const form = e.target;
    // Validação básica do HTML5
    if (!form.checkValidity()) {
        form.reportValidity(); // Mostra as mensagens de erro padrão do navegador
        // Encontra o primeiro campo inválido para focar (melhora usabilidade)
        const firstInvalidField = form.querySelector(':invalid');
        if (firstInvalidField) {
             firstInvalidField.focus();
        }
        return showToast('Por favor, preencha todos os campos obrigatórios marcados.');
    }

    const data = getAbsenceFormData(); // Pega os dados do formulário
    if (!data) return; // Se getAbsenceFormData retornar null (ex: aluno inválido)

    try {
        const id = data.id; // Pega o ID (se estiver editando)
        delete data.id; // Remove o ID do objeto de dados a ser salvo

        const historyAction = id ? "Dados da ação atualizados." : `Ação '${actionDisplayTitles[data.actionType] || data.actionType}' registada.`;

        if (id) {
            // Atualiza registro existente
            await updateRecordWithHistory('absence', id, data, historyAction, state.userEmail);
        } else {
            // Cria novo registro
            await addRecordWithHistory('absence', data, historyAction, state.userEmail);
        }

        showToast(`Ação ${id ? 'atualizada' : 'registada'} com sucesso!`);
        closeModal(dom.absenceModal); // Fecha o modal

        // Verifica se o aluno retornou e se a próxima ação é 'analise'
        const studentReturned = data.contactReturned === 'yes' || data.visitReturned === 'yes' || data.ctReturned === 'yes';
        const nextActionIsAnalise = determineNextActionForStudent(data.studentId) === 'analise';

        // Se o aluno retornou E a próxima ação é análise, abre o modal de análise
        // Evita abrir análise se já estiver concluído ou se a próxima ação for outra
        if (studentReturned && nextActionIsAnalise) {
            const student = state.students.find(s => s.matricula === data.studentId);
            // Adiciona um pequeno delay para garantir que o modal anterior fechou
            setTimeout(() => {
                if(student) openAbsenceModalForStudent(student, 'analise');
            }, 350);
        }
    } catch (error) {
        console.error("Erro ao salvar ação de BA:", error);
        const firestoreError = error.code ? getFirestoreErrorMessage(error.code) : null;
        showToast(firestoreError || 'Erro ao salvar ação.');
    }
}


// Ações de Exclusão (Genérico)
/**
 * Handler genérico chamado pelo botão "Excluir" no modal de confirmação.
 * Usa o estado `state.recordToDelete` que foi preparado pelo listener específico (ex: handleDeleteOccurrence).
 */
async function handleDeleteConfirmation() {
    if (!state.recordToDelete) return;

    const { type, id } = state.recordToDelete; // 'id' pode ser groupId para ocorrência

    try {
        let successMessage = 'Registro excluído com sucesso.';

        if (type === 'occurrence') {
            // Excluir incidente (grupo) e todos os registros individuais associados
            const q = query(getCollectionRef('occurrence'), where('occurrenceGroupId', '==', id));
            const querySnapshot = await getDocs(q);
            if (querySnapshot.empty) {
                 // Segurança: Se não encontrou registros, talvez já tenha sido excluído?
                 console.warn(`Nenhum registro encontrado para o grupo de ocorrência ${id} ao tentar excluir.`);
                 // Poderia tentar excluir só pelo ID principal se fosse um registro individual sem grupo?
                 // await deleteRecord('occurrence', id); // CUIDADO: verificar a lógica se isso for possível
            } else {
                const batch = writeBatch(db);
                querySnapshot.forEach(doc => batch.delete(doc.ref)); // Adiciona todos ao batch
                await batch.commit(); // Executa a exclusão em lote
                successMessage = 'Incidente e todos os registros associados foram excluídos.';
            }
        } else if (type === 'absence-cascade') {
            // Excluir ação de CT e a análise associada (se houver)
            const { ctId, analiseId } = state.recordToDelete;
            const batch = writeBatch(db);
            batch.delete(doc(getCollectionRef('absence'), ctId)); // Deleta a ação CT
            if (analiseId) {
                batch.delete(doc(getCollectionRef('absence'), analiseId)); // Deleta a análise
            }
            await batch.commit();
            successMessage = 'Encaminhamento e Análise associada foram excluídos.';
        } else if (type === 'absence') {
             // Excluir uma única ação de busca ativa
             await deleteRecord('absence', id);
             successMessage = 'Ação de Busca Ativa excluída com sucesso.';
        }
        // Adicionar outros tipos aqui se necessário (ex: type === 'student')

        showToast(successMessage);
    } catch (error) {
        console.error(`Erro ao excluir ${type} com id ${id}:`, error);
        const firestoreError = error.code ? getFirestoreErrorMessage(error.code) : null;
        showToast(firestoreError || 'Erro ao excluir.');
    } finally {
        state.recordToDelete = null; // Limpa o estado
        closeModal(dom.deleteConfirmModal); // Fecha o modal de confirmação
        // render(); // O onSnapshot deve cuidar da atualização da lista
    }
}


// <-- MUDANÇA: Função movida para occurrence.js
// function getOccurrenceHistoryMessage(original, updated) { ... }

/**
 * Coleta os dados do formulário de Busca Ativa.
 * (Movido de main.js, mas permanece aqui pois é chamado por handleAbsenceSubmit)
 */
function getAbsenceFormData() {
    const studentName = document.getElementById('absence-student-name').value.trim();
    const student = state.students.find(s => s.name === studentName);
    if (!student) {
        showToast("Aluno inválido selecionado no formulário.");
        return null;
    }

    const data = {
        id: document.getElementById('absence-id').value || null, // ID para edição
        studentId: student.matricula,
        actionType: document.getElementById('action-type').value,
        processId: document.getElementById('absence-process-id').value,
        // Campos de Faltas (podem ser null se não for a 1ª ação)
        periodoFaltasStart: document.getElementById('absence-start-date').value || null,
        periodoFaltasEnd: document.getElementById('absence-end-date').value || null,
        absenceCount: document.getElementById('absence-count').value || null,
    };

    // Coleta dados específicos do tipo de ação
    if (data.actionType.startsWith('tentativa')) {
        const contactSucceededRadio = document.querySelector('input[name="contact-succeeded"]:checked');
        data.meetingDate = document.getElementById('meeting-date').value || null;
        data.meetingTime = document.getElementById('meeting-time').value || null;
        data.contactSucceeded = contactSucceededRadio ? contactSucceededRadio.value : null;
        // Só coleta detalhes do contato se 'Sim' foi marcado
        if (data.contactSucceeded === 'yes') {
            data.contactType = document.getElementById('absence-contact-type').value || null;
            data.contactDate = document.getElementById('contact-date').value || null;
            data.contactPerson = document.getElementById('contact-person').value.trim() || null;
            data.contactReason = document.getElementById('contact-reason').value.trim() || null;
        } else {
             // Garante que campos dependentes fiquem nulos se 'Não' ou não marcado
             data.contactType = null;
             data.contactDate = null;
             data.contactPerson = null;
             data.contactReason = null;
        }
        const contactReturnedRadio = document.querySelector('input[name="contact-returned"]:checked');
        data.contactReturned = contactReturnedRadio ? contactReturnedRadio.value : null;

    } else if (data.actionType === 'visita') {
        const visitSucceededRadio = document.querySelector('input[name="visit-succeeded"]:checked');
        data.visitAgent = document.getElementById('visit-agent').value.trim() || null;
        data.visitDate = document.getElementById('visit-date').value || null;
        data.visitSucceeded = visitSucceededRadio ? visitSucceededRadio.value : null;
        // Só coleta detalhes se 'Sim' foi marcado
        if (data.visitSucceeded === 'yes') {
            data.visitContactPerson = document.getElementById('visit-contact-person').value.trim() || null;
            data.visitReason = document.getElementById('visit-reason').value.trim() || null;
            data.visitObs = document.getElementById('visit-obs').value.trim() || null;
        } else {
            // Garante que campos dependentes fiquem nulos
            data.visitContactPerson = null;
            data.visitReason = null;
            data.visitObs = null;
        }
        const visitReturnedRadio = document.querySelector('input[name="visit-returned"]:checked');
        data.visitReturned = visitReturnedRadio ? visitReturnedRadio.value : null;

    } else if (data.actionType === 'encaminhamento_ct') {
        data.ctSentDate = document.getElementById('ct-sent-date').value || null;
        data.ctFeedback = document.getElementById('ct-feedback').value.trim() || null;
        const ctReturnedRadio = document.querySelector('input[name="ct-returned"]:checked');
        data.ctReturned = ctReturnedRadio ? ctReturnedRadio.value : null;
        // Mantém número do ofício se já existir (ao editar)
        const existingData = data.id ? state.absences.find(a => a.id === data.id) : null;
        data.oficioNumber = existingData?.oficioNumber || null;
        data.oficioYear = existingData?.oficioYear || null;

    } else if (data.actionType === 'analise') {
        data.ctParecer = document.getElementById('ct-parecer').value.trim() || null;
    }

    // Remove o ID se for nulo (para evitar salvar um campo 'id: null' na criação)
    if (data.id === null) {
        delete data.id;
    }

    return data;
}

// <-- MUDANÇA: Função movida para absence.js (ou ui.js, dependendo da decisão final)
// function handleActionTypeChange(action) { ... }

// --- CONFIGURAÇÃO DE LISTENERS DINÂMICOS ---

/**
 * Configura os botões de fechar para todos os modais.
 * (Movido de main.js, agora mais robusto)
 */
function setupModalCloseButtons() {
    const modalMap = {
        // IDs dos Botões de Fechar -> Referência do Modal no objeto dom
        'close-modal-btn': dom.occurrenceModal,
        'cancel-btn': dom.occurrenceModal, // Botão Cancelar do modal Ocorrência
        'close-absence-modal-btn': dom.absenceModal,
        'cancel-absence-btn': dom.absenceModal, // Botão Cancelar do modal Busca Ativa
        'close-report-generator-btn': dom.reportGeneratorModal,
        'cancel-report-generator-btn': dom.reportGeneratorModal, // Botão Cancelar do Gerador Relatório
        'close-notification-btn': dom.notificationModalBackdrop,
        'close-student-selection-modal-btn': document.getElementById('student-selection-modal'), // Este modal não está no dom object
        'close-report-view-btn': dom.reportViewModalBackdrop,
        'close-ficha-view-btn': dom.fichaViewModalBackdrop,
        'close-history-view-btn': document.getElementById('history-view-modal-backdrop'), // Este modal não está no dom object
        'close-students-modal-btn': dom.studentsModal,
        'cancel-delete-btn': dom.deleteConfirmModal, // Botão Cancelar do modal de Exclusão
        'close-settings-modal-btn': dom.settingsModal,
        'cancel-settings-btn': dom.settingsModal, // Botão Cancelar do modal Configurações
        'close-follow-up-modal-btn': dom.followUpModal,
        'cancel-follow-up-btn': dom.followUpModal // Botão Cancelar do modal Acompanhamento
    };

    for (const [buttonId, modalElement] of Object.entries(modalMap)) {
        const button = document.getElementById(buttonId);
        if (button && modalElement) {
            // Remove listener antigo se existir (para evitar duplicação em recarregamentos HMR)
            const oldListener = button.__clickListener;
            if (oldListener) {
                button.removeEventListener('click', oldListener);
            }
            // Adiciona o novo listener
            const newListener = () => closeModal(modalElement);
            button.addEventListener('click', newListener);
            button.__clickListener = newListener; // Guarda referência

             // Remove atributo onclick antigo, se houver
             if (button.hasAttribute('onclick')) {
                button.removeAttribute('onclick');
            }
        } else if (!button) {
            // Avisa se um botão esperado não for encontrado (ajuda a depurar HTML)
            // console.warn(`Botão com ID "${buttonId}" não encontrado no DOM.`);
        } else if (!modalElement) {
            // Avisa se o modal correspondente não foi encontrado (ajuda a depurar state.js/HTML)
            console.warn(`Modal para o botão "${buttonId}" não encontrado.`);
        }
    }

    // Listeners dos botões de Partilhar e Imprimir (mantêm-se iguais)
    document.getElementById('share-btn')?.addEventListener('click', () => shareContent(document.getElementById('notification-title')?.textContent || 'Notificação', document.getElementById('notification-content')?.innerText || ''));
    document.getElementById('report-share-btn')?.addEventListener('click', () => shareContent(document.getElementById('report-view-title')?.textContent || 'Relatório', document.getElementById('report-view-content')?.innerText || ''));
    document.getElementById('ficha-share-btn')?.addEventListener('click', () => shareContent(document.getElementById('ficha-view-title')?.textContent || 'Documento', document.getElementById('ficha-view-content')?.innerText || ''));
    document.getElementById('print-btn')?.addEventListener('click', () => window.print());
    document.getElementById('report-print-btn')?.addEventListener('click', () => window.print());
    document.getElementById('ficha-print-btn')?.addEventListener('click', () => window.print());
}

/**
 * Configura os listeners de clique APENAS para a lista de Busca Ativa.
 * A lógica de ocorrências foi movida para occurrence.js.
 */
// <-- MUDANÇA: Renomeada para clareza
function setupListClickListeners_Absences() {

    // Listener para a lista de BUSCA ATIVA
    if (dom.absencesListDiv) {
        dom.absencesListDiv.addEventListener('click', (e) => {
            const button = e.target.closest('button');
            if (button) {
                e.stopPropagation(); // Evita propagação

                 // Ação do menu Kebab
                 if (button.classList.contains('kebab-menu-btn')) {
                    const dropdown = button.nextElementSibling;
                    if (dropdown) {
                        // Fecha outros menus
                        document.querySelectorAll('.kebab-menu-dropdown').forEach(d => {
                            if (d !== dropdown) d.classList.add('hidden');
                        });

                        // Lógica de Overflow para o acordeão
                        const contentParent = button.closest('.process-content');
                        if (contentParent && dropdown.classList.contains('hidden')) { // Abrindo
                            contentParent.style.overflow = 'visible';
                        } else if (contentParent) { // Fechando
                            setTimeout(() => {
                                if (dropdown.classList.contains('hidden')) {
                                    contentParent.style.overflow = 'hidden';
                                }
                            }, 250);
                        }
                        dropdown.classList.toggle('hidden'); // Abre/Fecha
                    }
                    return; // Encerra aqui
                }

                const id = button.dataset.id; // ID do registro Firestore da ação específica

                // Botões de Ação Principais da Linha
                if (button.classList.contains('notification-btn')) openFichaViewModal(id);
                else if (button.classList.contains('send-ct-btn')) handleSendToCT(id);
                else if (button.classList.contains('view-oficio-btn')) handleViewOficio(id);
                else if (button.classList.contains('generate-ficha-btn-row')) generateAndShowConsolidatedFicha(button.dataset.studentId, button.dataset.processId);
                // Ações do Menu Kebab
                else if (button.classList.contains('kebab-action-btn')) {
                    const action = button.dataset.action;
                    if (action === 'edit') handleEditAbsence(id);
                    else if (action === 'delete') handleDeleteAbsence(id); // Prepara para confirmação
                    else if (action === 'history') openAbsenceHistoryModal(button.dataset.processId);

                    // Fecha o menu após a ação e restaura overflow
                    const dropdown = button.closest('.kebab-menu-dropdown');
                    if (dropdown) dropdown.classList.add('hidden');
                    const contentParent = button.closest('.process-content');
                    if(contentParent) contentParent.style.overflow = 'hidden';
                }
                return; // Encerra se clicou num botão
            }

            // Clique para abrir/fechar o acordeão (Acordeão = Processo)
            const header = e.target.closest('.process-header');
            if (header) {
                const processId = header.dataset.processId;
                const content = document.getElementById(`content-${processId}`);
                const icon = header.querySelector('i.fa-chevron-down');
                if (content) {
                    const isHidden = !content.style.maxHeight || content.style.maxHeight === '0px';
                    if (isHidden) {
                        // Ao abrir, define maxHeight para a altura do conteúdo e permite overflow visível
                        content.style.maxHeight = `${content.scrollHeight}px`;
                         // A lógica de overflow agora é controlada pelo Kebab
                        // content.style.overflow = 'visible'; // Permite que o dropdown Kebab apareça
                    } else {
                        // Ao fechar, reseta maxHeight e garante overflow hidden
                        content.style.maxHeight = null; // Equivalente a '0px' na transição
                        content.style.overflow = 'hidden';
                    }
                    icon?.classList.toggle('rotate-180', isHidden); // Gira o ícone
                }
                return; // Impede que o clique no header feche menus Kebab abertos
            }

            // Clique para iniciar nova ação a partir do nome do aluno no histórico
            const newActionTrigger = e.target.closest('.new-action-from-history-btn');
            if (newActionTrigger) {
                e.stopPropagation();
                handleNewAbsenceFromHistory(newActionTrigger.dataset.studentId);
                return;
            }
        });
    } // Fim if (dom.absencesListDiv)
}

// <-- MUDANÇA: Função movida para occurrence.js
// function handleEditOccurrence(groupId) { ... }

// <-- MUDANÇA: Lógica específica movida para handleDeleteOccurrence em occurrence.js
// function handleDelete(type, id) { ... } // A função genérica handleDeleteConfirmation permanece


/**
 * Lida com a ação de editar uma ação de Busca Ativa.
 * (Movido de main.js, mas permanece aqui pois é chamado pelo listener da lista de BA)
 */
function handleEditAbsence(id) {
    const data = state.absences.find(a => a.id === id);
    if (!data) return showToast("Registro da ação não encontrado.");

    const student = state.students.find(s => s.matricula === data.studentId);
    if (!student) return showToast("Aluno associado a esta ação não encontrado.");

    // Abre o modal de Busca Ativa em modo de edição, forçando o tipo da ação existente
    openAbsenceModalForStudent(student, data.actionType, data);
}

/**
 * Prepara a exclusão de uma ação de Busca Ativa, verificando dependências.
 * (Movido de main.js, mas permanece aqui pois é chamado pelo listener da lista de BA)
 */
function handleDeleteAbsence(id) {
    const actionToDelete = state.absences.find(a => a.id === id);
    if (!actionToDelete) return showToast("Registro da ação não encontrado.");

    // Define a sequência lógica das ações
    const sequence = ['tentativa_1', 'tentativa_2', 'tentativa_3', 'visita', 'encaminhamento_ct', 'analise'];
    // Encontra todas as ações do mesmo processo
    const processActions = state.absences.filter(a => a.processId === actionToDelete.processId);
    // Encontra o índice da ação a ser excluída na sequência
    const deleteIndex = sequence.indexOf(actionToDelete.actionType);

    // Verifica se existe alguma ação posterior no mesmo processo
    const hasLaterAction = processActions.some(a => {
        const actionIndex = sequence.indexOf(a.actionType);
        // Considera uma ação como posterior se seu índice na sequência for maior
        return actionIndex > deleteIndex;
    });

    // Se houver ação posterior, impede a exclusão
    if (hasLaterAction) {
        return showToast("Não é possível excluir esta etapa. Exclua a(s) etapa(s) mais recente(s) do processo primeiro.");
    }

    // Lógica específica se for excluir o Encaminhamento CT
    if (actionToDelete.actionType === 'encaminhamento_ct') {
        // Verifica se existe uma ação de Análise no mesmo processo
        const analiseAction = processActions.find(a => a.actionType === 'analise');
        // Prepara para exclusão em cascata (CT + Análise)
        document.getElementById('delete-confirm-message').textContent = 'A etapa de Análise associada (se existir) também será excluída. Deseja continuar?';
        state.recordToDelete = {
            type: 'absence-cascade', // Tipo especial para indicar cascata
            ctId: id, // ID da ação CT a ser excluída
            analiseId: analiseAction ? analiseAction.id : null // ID da análise (ou null se não existir)
        };
    } else {
        // Exclusão normal de uma única ação
        document.getElementById('delete-confirm-message').textContent = `Tem certeza que deseja excluir a ação "${actionDisplayTitles[actionToDelete.actionType] || actionToDelete.actionType}"?`;
        state.recordToDelete = { type: 'absence', id: id };
    }

    // Abre o modal de confirmação genérico
    openModal(dom.deleteConfirmModal);
}

/**
 * Lida com o clique no botão "Enviar ao C.T.", gerando ofício e criando a ação.
 * (Movido de main.js, mas permanece aqui pois é chamado pelo listener da lista de BA)
 */
async function handleSendToCT(id) {
    const visitAction = state.absences.find(a => a.id === id);
    if (!visitAction || visitAction.actionType !== 'visita') {
        return showToast("Ação de visita não encontrada ou inválida.");
    }

    // Pede o número do ofício ANTES de gerar
    const oficioNumber = prompt("Por favor, insira o número do ofício para este encaminhamento:");
    // Verifica se o usuário inseriu algo e não cancelou
    if (oficioNumber === null) return; // Usuário cancelou
    if (!oficioNumber.trim()) {
         return showToast("Número do ofício inválido.");
    }

    // Gera e mostra o ofício primeiro (visualização)
    generateAndShowOficio(visitAction, oficioNumber.trim());

    // --- Lógica para salvar a ação 'encaminhamento_ct' ---
    const student = state.students.find(s => s.matricula === visitAction.studentId);
    if (!student) {
        console.error("Aluno da visita não encontrado para salvar encaminhamento.");
        return; // Não salva se não encontrar o aluno
    }

    // Verifica se já existe uma ação 'encaminhamento_ct' neste ciclo para evitar duplicar
    const { processId, currentCycleActions } = logic.getStudentProcessInfo(student.matricula);
    if (currentCycleActions.some(a => a.actionType === 'encaminhamento_ct')) {
         console.log("Ação 'encaminhamento_ct' já existe para este ciclo. Não será criada novamente.");
         return; // Não cria se já existe
    }

    // Encontra a primeira ação do ciclo que contém os dados das faltas
    const firstAction = currentCycleActions.find(a => a.periodoFaltasStart);

    // Prepara os dados para a nova ação 'encaminhamento_ct'
    const dataForCt = {
        studentId: student.matricula,
        actionType: 'encaminhamento_ct',
        processId: processId, // Usa o ID do processo atual
        ctSentDate: new Date().toISOString().split('T')[0], // Data de hoje
        oficioNumber: oficioNumber.trim(),
        oficioYear: new Date().getFullYear(),
        // Copia dados das faltas da primeira ação do ciclo
        periodoFaltasStart: firstAction?.periodoFaltasStart || null,
        periodoFaltasEnd: firstAction?.periodoFaltasEnd || null,
        absenceCount: firstAction?.absenceCount || null,
        // Campos de feedback e retorno começam vazios
        ctFeedback: null,
        ctReturned: null
    };

    try {
        // Adiciona o novo registro ao Firestore
        await addRecordWithHistory('absence', dataForCt, "Ação 'Encaminhamento ao CT' registada automaticamente após gerar ofício.", state.userEmail);
        showToast("Registro de 'Encaminhamento ao CT' salvo automaticamente.");
        // O onSnapshot atualizará a lista, mostrando a nova ação.
    } catch(err) {
        console.error("Erro ao salvar encaminhamento automático:", err);
        showToast("Erro ao salvar o registro do encaminhamento automático.");
    }
}

/**
 * Lida com o clique para visualizar um ofício já existente.
 * (Movido de main.js, mas permanece aqui pois é chamado pelo listener da lista de BA)
 */
function handleViewOficio(id) {
    const ctAction = state.absences.find(a => a.id === id);
    if (ctAction && ctAction.actionType === 'encaminhamento_ct') {
        generateAndShowOficio(ctAction); // Gera usando os dados existentes (incluindo oficioNumber)
    } else {
        showToast("Registro de encaminhamento não encontrado ou inválido.");
    }
}

/**
 * Lida com o clique no nome do aluno no histórico para iniciar uma nova ação.
 * (Movido de main.js, mas permanece aqui pois é chamado pelo listener da lista de BA)
 */
function handleNewAbsenceFromHistory(studentId) {
    const student = state.students.find(s => s.matricula === studentId);
    if (student) {
        handleNewAbsenceAction(student); // Chama a função que abre o modal apropriado
    } else {
        showToast("Aluno não encontrado.");
    }
}

