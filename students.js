// =================================================================================
// ARQUIVO: students.js

import { state, dom } from './state.js';
import { setDoc, doc, writeBatch, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStudentsCollectionRef, loadStudents } from './firestore.js'; // Importa loadStudents para recarregar após salvar
import { db } from './firebase.js'; // Necessário para batch
import { showToast, openModal, loadScript } from './utils.js'; 

/**
 * Renderiza a lista de alunos no modal "Gerir Alunos".
 * A lógica de clique será gerenciada por delegação de eventos
 * em `handleStudentTableActions` dentro deste módulo.
 */
const renderStudentsList = () => {
    // Usa a referência do DOM já inicializada
    const tableBody = dom.studentsListTable;
    if (!tableBody) return; // Guarda de segurança

    tableBody.innerHTML = ''; // Limpa a tabela antes de redesenhar.

    // Ordena em memória para exibição (escalabilidade visual)
    state.students.sort((a,b) => a.name.localeCompare(b.name)).forEach(student => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="px-4 py-2 text-sm text-gray-900">${student.name}</td>
            <td class="px-4 py-2 text-sm text-gray-500">${student.class}</td>
            <td class="px-4 py-2 text-right text-sm space-x-2">
                <button class="edit-student-btn text-yellow-600 hover:text-yellow-900" data-id="${student.matricula}" title="Editar">
                    <i class="fas fa-pencil-alt"></i>
                </button>
                <button class="delete-student-btn text-red-600 hover:text-red-900" data-id="${student.matricula}" title="Excluir">
                    <i class="fas fa-trash"></i>
                </button>
            </td>`;
        tableBody.appendChild(row);
    });
};

/**
 * Reseta o formulário de adição/edição de aluno.
 */
const resetStudentForm = () => {
    document.getElementById('student-form-title').textContent = 'Adicionar Novo Aluno';
    dom.studentForm.reset(); // Usa a referência do DOM
    document.getElementById('student-id-input').value = '';
    document.getElementById('student-matricula-input').readOnly = false;
    document.getElementById('student-matricula-input').classList.remove('bg-gray-100');
    dom.cancelEditStudentBtn.classList.add('hidden'); 
};

/**
 * Lida com o upload do ficheiro CSV de alunos.
 * (MODIFICADO - ESCALÁVEL) Agora usa Batches do Firestore para salvar individualmente.
 */
async function handleCsvUpload() {
    const fileInput = dom.csvFile; 
    const feedbackDiv = dom.csvFeedback; 

    if (fileInput.files.length === 0) return showToast("Por favor, selecione um ficheiro CSV.");

    try {
        // Verifica se Papa já está carregado
        if (typeof window.Papa === 'undefined') {
            feedbackDiv.innerHTML = `<p class="text-sky-500">A carregar biblioteca de CSV...</p>`; 
            const papaScriptUrl = 'https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js';
            await loadScript(papaScriptUrl);
            if (typeof window.Papa === 'undefined') {
                 throw new Error("Falha ao carregar PapaParse dinamicamente.");
            }
            feedbackDiv.innerHTML = '';
        }

        window.Papa.parse(fileInput.files[0], {
            header: true,
            skipEmptyLines: true,
            transformHeader: header => header.toLowerCase().trim().replace(/\s+/g, ''),
            complete: async (results) => {
                if (!results.meta || !results.meta.fields) {
                    feedbackDiv.innerHTML = `<p class="text-red-500">Erro: Não foi possível ler os cabeçalhos do ficheiro CSV.</p>`;
                    console.error("Erro ao processar CSV: Metadados inválidos", results);
                    return;
                }

                const requiredHeaders = ['matricula', 'nome', 'turma', 'endereco', 'contato', 'resp1', 'resp2'];
                const hasAllHeaders = requiredHeaders.every(h => results.meta.fields.includes(h));
                if (!hasAllHeaders) {
                    feedbackDiv.innerHTML = `<p class="text-red-500">Erro: Faltam colunas. O ficheiro CSV deve conter: ${requiredHeaders.join(', ')}.</p>`;
                    return;
                }

                if (!Array.isArray(results.data)) {
                     feedbackDiv.innerHTML = `<p class="text-red-500">Erro: Não foi possível ler os dados do ficheiro CSV.</p>`;
                     console.error("Erro ao processar CSV: Dados inválidos", results);
                     return;
                }

                // Filtra linhas inválidas
                const validStudents = results.data.map(row => ({
                    matricula: row.matricula ? String(row.matricula).trim() : '',
                    name: row.nome ? String(row.nome).trim() : '',
                    class: row.turma || '',
                    endereco: row.endereco || '',
                    contato: row.contato || '',
                    resp1: row.resp1 || '',
                    resp2: row.resp2 || ''
                })).filter(s => s.name && s.matricula);

                if (validStudents.length === 0) {
                     feedbackDiv.innerHTML = `<p class="text-red-500">Nenhum aluno válido encontrado no CSV.</p>`;
                     return;
                }

                // --- LÓGICA DE BATCH (LOTE) ---
                // O Firestore permite no máximo 500 operações por batch.
                const BATCH_SIZE = 450; // Margem de segurança
                const chunks = [];
                for (let i = 0; i < validStudents.length; i += BATCH_SIZE) {
                    chunks.push(validStudents.slice(i, i + BATCH_SIZE));
                }

                feedbackDiv.innerHTML = `<p class="text-sky-600">A processar ${validStudents.length} alunos em ${chunks.length} lotes...</p>`;

                const collectionRef = getStudentsCollectionRef();
                let processedCount = 0;

                try {
                    for (const chunk of chunks) {
                        const batch = writeBatch(db);
                        chunk.forEach(student => {
                            // Usa a Matrícula como ID do documento (evita duplicatas automaticamente)
                            const docRef = doc(collectionRef, student.matricula);
                            batch.set(docRef, student);
                        });
                        await batch.commit();
                        processedCount += chunk.length;
                        feedbackDiv.innerHTML = `<p class="text-sky-600">Salvo lote de ${processedCount}/${validStudents.length} alunos...</p>`;
                    }

                    // Recarrega a lista do Firestore para atualizar a UI e o State
                    await loadStudents();
                    
                    renderStudentsList();
                    showToast(`${processedCount} alunos importados/atualizados com sucesso!`);
                    fileInput.value = '';
                    feedbackDiv.innerHTML = `<p class="text-green-600 font-bold">Importação concluída com sucesso!</p>`;
                    setTimeout(() => feedbackDiv.innerHTML = '', 5000);

                } catch(error) {
                    console.error("Erro ao salvar lote no Firestore:", error);
                    // --- MELHORIA DE ERRO ---
                    let msg = error.message;
                    if (error.code === 'permission-denied' || msg.includes("Missing or insufficient permissions")) {
                        msg = "Permissão negada! Verifique se as Regras de Segurança (firestore.rules) foram publicadas no Console do Firebase.";
                    }
                    feedbackDiv.innerHTML = `<p class="text-red-500 font-bold">${msg}</p>`;
                    showToast("Erro de permissão ao salvar dados.");
                }
            },
            error: (error, file) => {
                console.error("Erro do PapaParse:", error, file);
                feedbackDiv.innerHTML = `<p class="text-red-500">Erro ao processar o ficheiro CSV: ${error.message}</p>`;
            }
        });

    } catch (error) {
        console.error("Erro ao carregar ou usar PapaParse:", error);
        feedbackDiv.innerHTML = `<p class="text-red-500">Erro crítico ao carregar a biblioteca de CSV. Tente novamente.</p>`;
        showToast("Erro ao carregar a biblioteca de leitura de CSV.");
    }
}

/**
 * Lida com a submissão do formulário de adição/edição de aluno.
 * (MODIFICADO - ESCALÁVEL) Usa setDoc num documento individual.
 */
async function handleStudentFormSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('student-id-input').value; // ID original (se edição)
    const matricula = document.getElementById('student-matricula-input').value.trim();
    const name = document.getElementById('student-name-input').value.trim();
    
    if (!matricula || !name) return showToast("Matrícula e Nome são obrigatórios.");

    const studentData = {
        matricula, name,
        class: document.getElementById('student-class-input').value.trim(),
        endereco: document.getElementById('student-endereco-input').value.trim(),
        contato: document.getElementById('student-contato-input').value.trim(),
        resp1: document.getElementById('student-resp1-input').value.trim(),
        resp2: document.getElementById('student-resp2-input').value.trim()
    };

    try {
        const collectionRef = getStudentsCollectionRef();

        if (id && id !== matricula) {
            // Se a matrícula mudou:
            // 1. Cria o novo documento com a nova matrícula
            await setDoc(doc(collectionRef, matricula), studentData);
            // 2. Deleta o documento antigo
            await deleteDoc(doc(collectionRef, id));
        } else {
            // Criação ou atualização (mesmo ID)
            await setDoc(doc(collectionRef, matricula), studentData, { merge: true });
        }

        // Atualiza o estado global localmente para performance
        if (id) {
            const index = state.students.findIndex(s => s.matricula === id);
            if (index > -1) state.students.splice(index, 1); // Remove antigo
        }
        const existingIndex = state.students.findIndex(s => s.matricula === matricula);
        if (existingIndex > -1) state.students[existingIndex] = studentData;
        else state.students.push(studentData);

        renderStudentsList(); 
        resetStudentForm(); 
        showToast(`Aluno ${id ? 'atualizado' : 'adicionado'} com sucesso.`);
        
    } catch(error) {
        console.error("Erro ao salvar aluno:", error);
        // --- MELHORIA DE ERRO ---
        if (error.code === 'permission-denied') {
             showToast("Erro de Permissão: Atualize as regras no Firebase Console.");
        } else {
             showToast("Erro ao salvar dados do aluno.");
        }
    }
}

/**
 * Lida com cliques nos botões de editar e excluir na tabela de alunos.
 * (MODIFICADO - ESCALÁVEL) Usa deleteDoc no documento individual.
 */
async function handleStudentTableActions(e) {
    const editBtn = e.target.closest('.edit-student-btn');
    if (editBtn) {
        const id = editBtn.dataset.id;
        const student = state.students.find(s => s.matricula === id);
        if (student) {
            // Preenche o formulário para edição
            document.getElementById('student-form-title').textContent = 'Editar Aluno';
            document.getElementById('student-id-input').value = student.matricula; // Guarda o ID original
            document.getElementById('student-matricula-input').value = student.matricula;
            document.getElementById('student-name-input').value = student.name;
            document.getElementById('student-class-input').value = student.class || '';
            document.getElementById('student-endereco-input').value = student.endereco || '';
            document.getElementById('student-contato-input').value = student.contato || '';
            document.getElementById('student-resp1-input').value = student.resp1 || '';
            document.getElementById('student-resp2-input').value = student.resp2 || '';
            dom.cancelEditStudentBtn.classList.remove('hidden'); 
        }
        return;
    }

    const deleteBtn = e.target.closest('.delete-student-btn');
    if (deleteBtn) {
        const id = deleteBtn.dataset.id;
        const student = state.students.find(s => s.matricula === id);
        
        if (student && confirm(`Tem a certeza que quer remover o aluno "${student.name}"? Esta ação não pode ser desfeita.`)) {
            try {
                // Deleta o documento individual da coleção
                await deleteDoc(doc(getStudentsCollectionRef(), id));
                
                // Atualiza estado local
                state.students = state.students.filter(s => s.matricula !== id);
                renderStudentsList(); 
                showToast("Aluno removido com sucesso.");
            } catch(error) {
                console.error("Erro ao remover aluno:", error);
                // --- MELHORIA DE ERRO ---
                if (error.code === 'permission-denied') {
                     showToast("Erro de Permissão: Atualize as regras no Firebase Console.");
                } else {
                     showToast("Erro ao remover aluno.");
                }
            }
        }
    }
}

/**
 * Função principal do módulo: anexa os listeners de eventos
 * aos elementos do modal "Gerir Alunos".
 */
export const initStudentListeners = () => {
    // Referências do DOM
    const manageStudentsBtn = document.getElementById('manage-students-btn');
    const { studentsModal, uploadCsvBtn, studentForm, cancelEditStudentBtn, studentsListTable } = dom;

    if (manageStudentsBtn && studentsModal) {
        manageStudentsBtn.addEventListener('click', () => {
            renderStudentsList(); 
            openModal(studentsModal);
        });
    }

    if (uploadCsvBtn) {
        uploadCsvBtn.addEventListener('click', handleCsvUpload);
    }

    if (studentForm) {
        studentForm.addEventListener('submit', handleStudentFormSubmit);
    }

    if (cancelEditStudentBtn) {
        cancelEditStudentBtn.addEventListener('click', resetStudentForm);
    }

    // Listener centralizado para a tabela (delegação de eventos)
    if (studentsListTable) {
        studentsListTable.addEventListener('click', handleStudentTableActions);
    }
};