import { type ChangeEvent, type FormEvent, useEffect, useState } from "react";
import { api, type Course, type Exam } from "./api";
import type { Act } from "./components";

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function CourseCard({ course, act }: { course: Course; act: Act }) {
  const [part, setPart] = useState<"resume" | "fiche" | "quiz" | null>(null);
  const [shown, setShown] = useState<Set<number>>(new Set());
  return (
    <li className="card course">
      <span className="what">
        <span className="title">{course.title}</span>
        {course.subject && <span className="meta">{course.subject}</span>}
      </span>
      <div className="row tabs">
        {(["resume", "fiche", "quiz"] as const).map((p) => (
          <button key={p} className={part === p ? "primary" : ""} onClick={() => setPart(part === p ? null : p)}>
            {p === "resume" ? "Résumé" : p === "fiche" ? "Fiche" : "Quiz"}
          </button>
        ))}
      </div>
      {part === "resume" && <p className="course-text">{course.summary}</p>}
      {part === "fiche" && <p className="course-text">{course.sheet}</p>}
      {part === "quiz" && (
        <ol className="quiz">
          {course.quiz.map((q, i) => (
            <li key={i}>
              <span>{q.question}</span>
              {shown.has(i) ? (
                <span className="muted">{q.answer}</span>
              ) : (
                <button className="link-button" onClick={() => setShown(new Set([...shown, i]))}>
                  Voir la réponse
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
      <button
        className="link-button remove"
        onClick={() => window.confirm(`Retirer le cours « ${course.title} » ?`) && act(() => api.removeCourse(course.id))}
      >
        Retirer
      </button>
    </li>
  );
}

/** Tableau de l'espace École : examens, révisions, cours. */
export function SchoolBoard({ act, version }: { act: Act; version: unknown }) {
  const [data, setData] = useState<{ exams: Exam[]; courses: Course[] } | null>(null);
  const [title, setTitle] = useState("");
  const [day, setDay] = useState("");
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    api.school().then(setData, () => setData(null));
  }, [version]);

  async function addExam(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !day) return;
    await act(() => api.addExam(title.trim(), day));
    setTitle("");
    setDay("");
  }

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    setMessage(null);
    try {
      const course = await api.addCourse(await readBase64(file), file.name);
      setMessage(`Cours prêt : ${course.title}.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Cours illisible.");
    }
    setUploading(false);
    await act(async () => undefined);
  }

  if (!data) return null;
  return (
    <>
      <h2>Examens</h2>
      {data.exams.length === 0 ? (
        <p className="muted">Aucun examen à venir. Ils sont repérés dans les mails de l'école et l'agenda.</p>
      ) : (
        <ul className="list">
          {data.exams.map((exam) => (
            <li key={exam.id} className="card slot exam">
              <span className="when">
                {exam.inDays === 0 ? "Aujourd'hui" : exam.inDays === 1 ? "Demain" : `J-${exam.inDays}`}
              </span>
              <span className="what">
                {exam.title}
                <span className="meta">
                  {new Date(`${exam.day}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
                  {exam.time && ` à ${exam.time}`}
                  {exam.revisionTaskIds.length > 0 && ` · révisions ${exam.revisionsDone}/${exam.revisionTaskIds.length}`}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <form className="card add exam-form" onSubmit={addExam}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nouvel examen" aria-label="Intitulé de l'examen" />
        <div className="row">
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} aria-label="Date de l'examen" />
          <button className="primary" type="submit" disabled={!title.trim() || !day}>
            Ajouter
          </button>
        </div>
      </form>

      <h2>Cours</h2>
      <label className={`button-like ${uploading ? "disabled" : ""}`}>
        {uploading ? "Lecture du cours…" : "Importer un cours (PDF)"}
        <input type="file" accept="application/pdf" onChange={upload} disabled={uploading} hidden />
      </label>
      {message && <p className="muted">{message}</p>}
      <ul className="list courses">
        {data.courses.map((course) => (
          <CourseCard key={course.id} course={course} act={act} />
        ))}
      </ul>
    </>
  );
}
