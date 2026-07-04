// ==========================================
// 1. UTILITIES & REUSE (Respons Konsisten + CORS)
// ==========================================
const jsonResponse = (data, status = 200) => {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
  });
};

// ==========================================
// 2. AUTHENTICATION MODULE (JWT Bearer)
// ==========================================
async function verifyJWT(request, secretKey) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.split(' ')[1];
  
  try {
    const [headerB64, payloadB64, signatureB64] = token.split('.');
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    return payload; 
  } catch (e) {
    return null;
  }
}

// ==========================================
// 3. DATABASE OPERATIONS (DRY & Modular)
// ==========================================
const ArticleModel = {
  async getAll(db) {
    const { results } = await db.prepare("SELECT * FROM articles ORDER BY created_at DESC").all();
    return results;
  },
  async getById(db, id) {
    return await db.prepare("SELECT * FROM articles WHERE id = ?").bind(id).first();
  },
  async create(db, { id, title, content, author }) {
    await db.prepare("INSERT INTO articles (id, title, content, author) VALUES (?, ?, ?, ?)")
      .bind(id, title, content, author)
      .run();
  },
  async update(db, id, { title, content }) {
    await db.prepare("UPDATE articles SET title = ?, content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(title, content, id)
      .run();
  },
  async delete(db, id) {
    await db.prepare("DELETE FROM articles WHERE id = ?").bind(id).run();
  }
};

const ExamModel = {
  async getAll(db) {
    const { results } = await db.prepare("SELECT * FROM exams ORDER BY created_at DESC").all();
    return results.map(row => ({
      ...row,
      questions: JSON.parse(row.questions)
    }));
  },
  async create(db, { id, title, description, duration, questions }) {
    const questionsStr = typeof questions === 'string' ? questions : JSON.stringify(questions);
    await db.prepare("INSERT INTO exams (id, title, description, duration, questions) VALUES (?, ?, ?, ?, ?)")
      .bind(id, title, description, parseInt(duration), questionsStr)
      .run();
  }
};

// --- TAMBAHAN MODEL RIWAYAT UNTUK CLOUD D1 ---
const ResultModel = {
  async getAll(db) {
    const { results } = await db.prepare("SELECT * FROM exam_results ORDER BY timestamp DESC").all();
    return results;
  },
  async create(db, { id, exam_id, exam_title, score, correct_count, total_questions, duration_used }) {
    await db.prepare(
      "INSERT INTO exam_results (id, exam_id, exam_title, score, correct_count, total_questions, duration_used) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(id, exam_id, exam_title, parseInt(score), parseInt(correct_count), parseInt(total_questions), parseInt(duration_used))
    .run();
  }
};

// ==========================================
// 4. ROUTER & HANDLERS (Scalable)
// ==========================================
export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        }
      });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const db = env.DB; 

    try {
      // ----------------------------------------
      // ENDPOINT ARTIKEL
      // ----------------------------------------
      if (path === "/api/articles") {
        if (method === "GET") {
          const articles = await ArticleModel.getAll(db);
          return jsonResponse({ success: true, data: articles });
        }
        
        if (method === "POST") {
          const payload = await verifyJWT(request, env.JWT_SECRET);
          const body = await request.json();
          if (!body.title || !body.content) {
            return jsonResponse({ error: "Missing title or content" }, 400);
          }
          const newArticle = {
            id: "art-" + Date.now(),
            title: body.title,
            content: body.content,
            author: payload ? payload.name : "Anonymous"
          };
          await ArticleModel.create(db, newArticle);
          return jsonResponse({ success: true, message: "Article created!", data: newArticle }, 201);
        }
      }

      if (path.startsWith("/api/articles/")) {
        const id = path.split("/")[3];
        if (method === "DELETE") {
          await ArticleModel.delete(db, id);
          return jsonResponse({ success: true, message: "Article deleted successfully" });
        }
      }

      // ----------------------------------------
      // ENDPOINT UJIAN (EXAMS)
      // ----------------------------------------
      if (path === "/api/exams") {
        if (method === "GET") {
          const exams = await ExamModel.getAll(db);
          return jsonResponse({ success: true, data: exams });
        }

        if (method === "POST") {
          let body;
          try {
            const rawText = await request.text();
            body = JSON.parse(rawText);
          } catch (jsonErr) {
            return jsonResponse({ error: "Format JSON yang Anda kirim tidak valid / rusak!", details: jsonErr.message }, 400);
          }
          
          if (!body || !body.title || !body.duration || !body.questions) {
            return jsonResponse({ 
              error: "Missing title, duration, or questions", 
              dataDiterimaServer: body || "Kosong" 
            }, 400);
          }

          const newExam = {
            id: body.id || "exam-\" + Date.now()",
            title: body.title,
            description: body.description || "",
            duration: body.duration,
            questions: body.questions 
          };

          await ExamModel.create(db, newExam);
          return jsonResponse({ success: true, message: "Exam created successfully!", data: newExam }, 201);
        }
      }

      // ----------------------------------------
      // ENDPOINT RIWAYAT UJIAN (RESULTS)
      // ----------------------------------------
      if (path === "/api/results") {
        if (method === "GET") {
          const results = await ResultModel.getAll(db);
          return jsonResponse({ success: true, data: results });
        }

        if (method === "POST") {
          const body = await request.json();
          const newResult = {
            id: body.id || "res-" + Date.now(),
            exam_id: body.examId,
            exam_title: body.examTitle,
            score: body.score,
            correct_count: body.correctCount,
            total_questions: body.totalQuestions,
            duration_used: body.durationUsed
          };
          await ResultModel.create(db, newResult);
          return jsonResponse({ success: true, message: "Result saved to cloud database!", data: newResult }, 201);
        }
      }

      return jsonResponse({ error: "Endpoint not found" }, 404);

    } catch (error) {
      return jsonResponse({ error: "Internal Server Error", message: error.message }, 500);
    }
  }
};
