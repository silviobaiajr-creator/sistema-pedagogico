
// =================================================================================
// ARQUIVO: settings.js

import { state, dom } from './state.js';
import { saveSchoolConfig, getCollectionRef, getStudentsCollectionRef } from './firestore.js';
import { showToast, closeModal, openModal, showAlert } from './utils.js';
import { writeBatch, doc, collection } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from './firebase.js';

/**
 * Abre o modal de configurações e preenche com os dados atuais.
 */
const openSettingsModal = () => {
    const settingsForm = dom.settingsForm; 
    if (settingsForm) {
        settingsForm.reset();
    }

    document.getElementById('school-name-input').value = state.config.schoolName || '';
    document.getElementById('school-city-input').value = state.config.city || '';
    document.getElementById('school-logo-input').value = state.config.schoolLogoUrl || '';
    
    document.getElementById('admin-emails-input').value = (state.config.adminEmails || []).join(', ');

    openModal(dom.settingsModal);
};

/**
 * Lida com a submissão do formulário de configurações.
 */
async function handleSettingsSubmit(e) {
    e.preventDefault();
    
    const emailsText = document.getElementById('admin-emails-input').value.trim();
    const adminEmails = emailsText
        .split(',') 
        .map(email => email.trim()) 
        .filter(email => email.length > 0); 

    const data = {
        schoolName: document.getElementById('school-name-input').value.trim(),
        city: document.getElementById('school-city-input').value.trim(),
        schoolLogoUrl: document.getElementById('school-logo-input').value.trim(),
        adminEmails: adminEmails 
    };

    try {
        await saveSchoolConfig(data);
        state.config = data; 
        dom.headerSchoolName.textContent = data.schoolName || 'Sistema de Acompanhamento'; 
        showToast('Configurações salvas com sucesso!');
        closeModal(dom.settingsModal);
    } catch (error) {
        console.error("Erro ao salvar configurações:", error);
        showToast('Erro ao salvar as configurações.');
    }
}

/**
 * Gera dados fictícios para teste de escalabilidade e relatórios.
 */
async function handleGenerateFakeData() {
    if (!confirm("ATENÇÃO: Esta ação irá gerar 50 alunos, 150 ocorrências e 50 ações de busca ativa fictícias no seu banco de dados.\n\nIsso serve para testar a capacidade do sistema.\n\nDeseja continuar?")) {
        return;
    }

    const btn = document.getElementById('btn-generate-fake-data');
    if(btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Gerando...'; }

    try {
        showToast("Iniciando geração de dados em massa...");
        const batch = writeBatch(db);
        
        // 1. Gerar Alunos (50)
        const students = [];
        const classes = ['1º A', '1º B', '2º A', '2º B', '3º A', '3º C', '9º U'];
        
        for (let i = 1; i <= 50; i++) {
            const studentId = `TESTE-${1000 + i}`;
            const studentData = {
                matricula: studentId,
                name: `Aluno Teste ${i}`,
                class: classes[Math.floor(Math.random() * classes.length)],
                contato: '(11) 99999-9999',
                endereco: `Rua dos Testes, ${i}`,
                resp1: `Responsável A ${i}`,
                resp2: `Responsável B ${i}`
            };
            const docRef = doc(getStudentsCollectionRef(), studentId);
            batch.set(docRef, studentData);
            students.push(studentData);
        }

        // 2. Gerar Ocorrências (150)
        // Espalhadas nos últimos 24 meses para testar filtros de data
        const types = ["Indisciplina", "Agressão (Verbal)", "Uso de Celular", "Agressão (Física)", "Bullying"];
        const statuses = ["Pendente", "Resolvido", "Aguardando Convocação 1", "Finalizada"];

        for (let i = 1; i <= 150; i++) {
            const student = students[Math.floor(Math.random() * students.length)];
            const date = new Date();
            date.setDate(date.getDate() - Math.floor(Math.random() * 730)); // Últimos 2 anos
            const dateStr = date.toISOString().split('T')[0];
            
            const groupId = `OCC-FAKE-${2000+i}`;
            // Criando referência para nova coleção
            const occRef = doc(collection(db, getCollectionRef('occurrence').path));

            batch.set(occRef, {
                occurrenceGroupId: groupId,
                studentId: student.matricula,
                studentName: student.name,
                studentClass: student.class,
                date: dateStr,
                occurrenceType: types[Math.floor(Math.random() * types.length)],
                description: `Esta é uma ocorrência de teste número ${i} gerada automaticamente para validação de carga.`,
                providenciasEscola: "Conversa com o aluno e registro em ata.",
                statusIndividual: statuses[Math.floor(Math.random() * statuses.length)],
                createdAt: date,
                createdBy: 'admin-teste@escola.com',
                history: [{ action: 'Dados gerados automaticamente.', user: 'sistema', timestamp: date }]
            });
        }

        // 3. Gerar Busca Ativa (50)
        const actions = ['tentativa_1', 'tentativa_2', 'visita', 'encaminhamento_ct'];
        
        for (let i = 1; i <= 50; i++) {
            const student = students[Math.floor(Math.random() * students.length)];
            const date = new Date();
            date.setDate(date.getDate() - Math.floor(Math.random() * 365)); // Último ano
            
            const absRef = doc(collection(db, getCollectionRef('absence').path));
            
            batch.set(absRef, {
                studentId: student.matricula,
                studentName: student.name,
                studentClass: student.class,
                processId: `PROC-FAKE-${i}`,
                actionType: actions[Math.floor(Math.random() * actions.length)],
                periodoFaltasStart: '2024-01-01',
                periodoFaltasEnd: '2024-02-01',
                absenceCount: Math.floor(Math.random() * 50) + 10,
                createdAt: date,
                createdBy: 'admin-teste@escola.com'
            });
        }

        await batch.commit();
        showToast("SUCESSO! 250 registros criados.");
        showAlert("Dados de teste gerados com sucesso!\n\nA página será recarregada para atualizar as listas.");
        
        setTimeout(() => window.location.reload(), 2000);

    } catch (error) {
        console.error("Erro ao gerar dados:", error);
        showAlert("Erro ao gerar dados: " + error.message);
        if(btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-database mr-1"></i> Gerar Dados de Teste'; }
    }
}

/**
 * Função principal do módulo: anexa os listeners de eventos
 */
export const initSettingsListeners = () => {
    const { settingsBtn, settingsForm } = dom;

    if (settingsBtn) {
        settingsBtn.addEventListener('click', openSettingsModal);
    }

    if (settingsForm) {
        settingsForm.addEventListener('submit', handleSettingsSubmit);
    }
    
    // Listener do botão de dados falsos
    const btnFake = document.getElementById('btn-generate-fake-data');
    if (btnFake) {
        btnFake.addEventListener('click', handleGenerateFakeData);
    }
};
