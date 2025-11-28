
// =================================================================================
// ARQUIVO: main.js
// VERSÃO: 3.2 (Com Verificação de Email Obrigatória)

import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { onSnapshot, query, writeBatch, doc, where, getDocs, limit, orderBy } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { auth, db } from './firebase.js';
import { state, dom, initializeDOMReferences } from './state.js';
import { showToast, closeModal, shareContent, openModal, showAlert } from './utils.js'; // Adicionado showAlert
import { loadStudents, loadSchoolConfig, getCollectionRef, deleteRecord, updateRecordWithHistory } from './firestore.js';

import { initAuthListeners } from './auth.js';
import { initSettingsListeners } from './settings.js';
import { initStudentListeners } from './students.js';
import { initOccurrenceListeners, renderOccurrences } from './occurrence.js'; 
import { initAbsenceListeners, renderAbsences } from './absence.js';     
import { initDashboard } from './dashboard.js'; 

import { occurrenceStepLogic } from './logic.js';

const SUPER_ADMIN_EMAILS = [
    'silviobaiajr@gmail.com' 
];

document.addEventListener('DOMContentLoaded', () => {
    initializeDOMReferences();
    state.db = db;

    onAuthStateChanged(auth, async user => {
        detachFirestoreListeners();
        
        if (user) {
            // --- BLOQUEIO DE SEGURANÇA: EMAIL NÃO VERIFICADO ---
            if (!user.emailVerified) {
                // Se o email não foi verificado, mostramos alerta e deslogamos
                showAlert("Acesso negado: Seu email ainda não foi verificado. Por favor, cheque sua caixa de entrada.");
                await signOut(auth);
                return; // Interrompe o carregamento do app
            }
            // ---------------------------------------------------

            state.userId = user.uid;
            state.userEmail = user.email;
            dom.userEmail.textContent = user.email || `Utilizador: ${user.uid.substring(0, 8)}`;
            dom.loginScreen.classList.add('hidden');
            dom.mainContent.classList.remove('hidden');
            dom.userProfile.classList.remove('hidden');

            // 1. Permissões
            state.isAdmin = SUPER_ADMIN_EMAILS.includes(user.email);

            try {
                await loadSchoolConfig(); 
                const dbAdminList = state.config.adminEmails || [];
                if (!state.isAdmin) {
                    state.isAdmin = dbAdminList.includes(user.email);
                }
                dom.headerSchoolName.textContent = state.config.schoolName || 'Sistema de Acompanhamento';
            } catch (configError) {
                console.warn("Aviso: Configurações não carregadas.", configError);
            }

            // Exibe botões admin
            if (state.isAdmin) {
                if(dom.settingsBtn) dom.settingsBtn.classList.remove('hidden');
                if(dom.manageStudentsBtn) dom.manageStudentsBtn.classList.remove('hidden');
            } else {
                if(dom.settingsBtn) dom.settingsBtn.classList.add('hidden');
                if(dom.manageStudentsBtn) dom.manageStudentsBtn.classList.add('hidden');
            }

            // 2. Carrega Dados Iniciais
            try {
                await loadStudents(); 
                setupFirestoreListeners(); 
                
                // 3. Inicia no Dashboard
                switchTab('dashboard'); 
                
            } catch (error) {
                console.error("Erro no carregamento:", error);
                showToast("Erro ao carregar dados.");
            }

        } else {
            // Logout / Não Autenticado
            state.userId = null; state.userEmail = null; state.students = []; state.occurrences = []; state.absences = [];
            dom.mainContent.classList.add('hidden');
            dom.userProfile.classList.add('hidden');
            dom.loginScreen.classList.remove('hidden');
            if(dom.settingsBtn) dom.settingsBtn.classList.add('hidden');
            if(dom.manageStudentsBtn) dom.manageStudentsBtn.classList.add('hidden');
        }
    });

    setupEventListeners();
});

function setupFirestoreListeners() {
    if (!state.userId) return;

    // Listeners limitados a 100 para UI
    const occurrencesQuery = query(getCollectionRef('occurrence'), orderBy('createdAt', 'desc'), limit(100));
    state.unsubscribeOccurrences = onSnapshot(occurrencesQuery, (snapshot) => {
        state.occurrences = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (state.activeTab === 'occurrences') renderOccurrences();
        if (state.activeTab === 'dashboard') initDashboard();
    });

    const absencesQuery = query(getCollectionRef('absence'), orderBy('createdAt', 'desc'), limit(100));
    state.unsubscribeAbsences = onSnapshot(absencesQuery, (snapshot) => {
        state.absences = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (state.activeTab === 'absences') renderAbsences();
        if (state.activeTab === 'dashboard') initDashboard();
    });
};

function detachFirestoreListeners() {
    if (state.unsubscribeOccurrences) state.unsubscribeOccurrences();
    if (state.unsubscribeAbsences) state.unsubscribeAbsences();
    state.unsubscribeOccurrences = null;
    state.unsubscribeAbsences = null;
};

function setupEventListeners() {
    initAuthListeners();
    dom.logoutBtn.addEventListener('click', () => signOut(auth));

    // Listeners de Navegação (Cards e Botões Voltar)
    if (dom.cardNavOccurrences) dom.cardNavOccurrences.addEventListener('click', () => switchTab('occurrences'));
    if (dom.cardNavAbsences) dom.cardNavAbsences.addEventListener('click', () => switchTab('absences'));
    
    if (dom.btnBackDashboardOcc) dom.btnBackDashboardOcc.addEventListener('click', () => switchTab('dashboard'));
    if (dom.btnBackDashboardAbs) dom.btnBackDashboardAbs.addEventListener('click', () => switchTab('dashboard'));

    setupModalCloseButtons();

    initSettingsListeners();
    initStudentListeners();
    initOccurrenceListeners(); 
    initAbsenceListeners();    

    document.getElementById('confirm-delete-btn').addEventListener('click', handleDeleteConfirmation);

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

function switchTab(tabName) {
    state.activeTab = tabName;
    
    // Reseta visualização
    [dom.tabContentDashboard, dom.tabContentOccurrences, dom.tabContentAbsences].forEach(el => el.classList.add('hidden'));

    // Ativa a selecionada
    if (tabName === 'dashboard') {
        dom.tabContentDashboard.classList.remove('hidden');
        initDashboard(); // Atualiza gráficos
    } else if (tabName === 'occurrences') {
        dom.tabContentOccurrences.classList.remove('hidden');
        renderOccurrences();
    } else if (tabName === 'absences') {
        dom.tabContentAbsences.classList.remove('hidden');
        renderAbsences();
    }
}

async function handleDeleteConfirmation() {
    if (!state.recordToDelete) return;
    const { type, id, recordId, actionToReset, historyAction } = state.recordToDelete;
    
    try {
        if (type === 'occurrence') {
            const q = query(getCollectionRef('occurrence'), where('occurrenceGroupId', '==', id));
            const querySnapshot = await getDocs(q);
            const batch = writeBatch(db);
            querySnapshot.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
            showToast('Incidente excluído.');

        } else if (type === 'occurrence-reset') {
            const logic = occurrenceStepLogic[actionToReset];
            if (!logic) throw new Error(`Lógica não encontrada: ${actionToReset}`);
            const dataToUpdate = {};
            for (const field of logic.fieldsToClear) { dataToUpdate[field] = null; }
            dataToUpdate.statusIndividual = logic.statusAfterReset;
            await updateRecordWithHistory('occurrence', recordId, dataToUpdate, historyAction, state.userEmail);
            showToast('Etapa resetada com sucesso.');
            
        } else {
            await deleteRecord(type, id);
            showToast('Registro excluído com sucesso.');
        }
    } catch (error) { 
        showToast('Erro ao processar exclusão.'); 
        console.error("Erro:", error); 
    } finally { 
        state.recordToDelete = null; 
        closeModal(dom.deleteConfirmModal); 
    }
}

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
        'cancel-follow-up-btn': dom.followUpModal,
        'close-send-ct-modal-btn': dom.sendOccurrenceCtModal,
        'cancel-send-ct-modal-btn': dom.sendOccurrenceCtModal,
        'close-absence-search-flow-modal-btn': dom.absenceSearchFlowModal, 
        'cancel-absence-search-flow-btn': dom.absenceSearchFlowModal,      
    };
    
    for (const [id, modal] of Object.entries(modalMap)) {
        const button = document.getElementById(id);
        if (button && modal) {
            const oldListener = button.__clickListener;
            if (oldListener) button.removeEventListener('click', oldListener);
            
            const newListener = () => closeModal(modal);
            button.addEventListener('click', newListener);
            button.__clickListener = newListener;
            
            if (button.hasAttribute('onclick')) button.removeAttribute('onclick');
        }
    }
    
    document.getElementById('share-btn').addEventListener('click', () => shareContent(document.getElementById('notification-title').textContent, document.getElementById('notification-content').innerText));
    document.getElementById('report-share-btn').addEventListener('click', () => shareContent(document.getElementById('report-view-title').textContent, document.getElementById('report-view-content').innerText));
    document.getElementById('ficha-share-btn').addEventListener('click', () => shareContent(document.getElementById('ficha-view-title').textContent, document.getElementById('ficha-view-content').innerText));

    document.getElementById('print-btn').addEventListener('click', () => window.print());
    document.getElementById('report-print-btn').addEventListener('click', () => window.print());
    document.getElementById('ficha-print-btn').addEventListener('click', () => window.print());
}
