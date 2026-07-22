'use strict';
/* Shared seed data. Uses only portable SQL + the async db interface,
   so it works identically on SQLite (local) and Postgres (production).

   Course-first model: Course (NEET / JEE) → Subject (course-scoped) → Chapter.
   The demo Physics/Chemistry content is seeded under BOTH courses so either
   course can be tested end-to-end. Biology (NEET) and Mathematics (JEE)
   start empty for the SME team to author. */

/* ---- demo content templates (authored once, seeded per course) ---- */
const TOPICS = [
  ['moi', 'Moment of Inertia'], ['torque', 'Torque'], ['angmom', 'Angular Momentum'],
  ['rolling', 'Rolling Motion'], ['angkin', 'Angular Kinematics']
];

const IQ = [
  { n: 14, topic: 'moi', correct: 'A', concept: 'Parallel-axis theorem',
    stem: 'The moment of inertia of a uniform solid sphere (mass M, radius R) about its diameter is (2/5)MR². Its moment of inertia about a tangent to its surface is:',
    options: [['A', '(7/5)MR²'], ['B', '(2/5)MR²'], ['C', '(5/2)MR²'], ['D', '(3/5)MR²']],
    solution: 'Parallel-axis theorem: I = I_cm + Md². Here d = R, so I = (2/5)MR² + MR² = (7/5)MR².',
    keyPoints: [
      'Parallel-axis theorem: I = I_cm + Md², where d is the distance from the centre of mass to the new axis.',
      'For a tangent to a sphere, d = R — so you ADD MR² to the about-diameter value.',
      'Solid sphere: about diameter = (2/5)MR², about tangent = (7/5)MR².'],
    note: 'Whenever the axis is shifted away from the centre of mass, add Md². Forgetting this term is the single most common mistake here.',
    source: 'AI',
    card: { front: 'Moment of inertia of a solid sphere about a tangent?', back: 'I_tangent = I_cm + MR² = (2/5)MR² + MR² = (7/5)MR². The extra +MR² comes straight from the parallel-axis theorem.' },
    video: { title: 'Parallel-axis theorem — derivation & worked examples', dur: '4:12' } },

  { n: 18, topic: 'torque', correct: 'A', concept: 'Torque = Iα',
    stem: 'A torque of 10 N·m acts on a rigid body whose moment of inertia is 2 kg·m². Its angular acceleration is:',
    options: [['A', '5 rad/s²'], ['B', '20 rad/s²'], ['C', '2.5 rad/s²'], ['D', '0.2 rad/s²']],
    solution: 'τ = Iα → α = τ/I = 10/2 = 5 rad/s².',
    keyPoints: [
      'The rotational analogue of F = ma is τ = Iα.',
      'Angular acceleration α = τ / I.',
      'Units: τ in N·m, I in kg·m², α in rad/s².'],
    note: 'τ = Iα is the master equation for rotational dynamics — always identify the torque and the moment of inertia first.',
    source: 'SME',
    card: { front: 'Rotational form of Newton’s second law?', back: 'τ = Iα. Torque plays the role of force, moment of inertia the role of mass, and angular acceleration the role of acceleration.' },
    video: { title: 'Torque and angular acceleration explained', dur: '3:28' } },

  { n: 21, topic: 'angmom', correct: 'A', concept: 'Conservation of angular momentum',
    stem: 'A skater pulls her arms in, halving her moment of inertia. With no external torque, her angular velocity:',
    options: [['A', 'Doubles'], ['B', 'Halves'], ['C', 'Stays the same'], ['D', 'Quadruples']],
    solution: 'L = Iω is conserved. If I becomes I/2, then ω must double to keep Iω constant.',
    keyPoints: [
      'With no external torque, angular momentum L = Iω is conserved.',
      'If I decreases, ω increases in proportion (and vice versa).',
      'Halving I doubles ω; tripling I makes ω one-third.'],
    note: 'Spot the phrase "no external torque" → use L = Iω = constant. The spinning skater pulling her arms in is the mental picture.',
    source: 'AI',
    card: { front: 'When is angular momentum conserved?', back: 'When the net external torque is zero. Then L = Iω stays constant, so if I decreases, ω increases.' },
    video: { title: 'Conservation of angular momentum — the skater effect', dur: '5:03' } },

  { n: 25, topic: 'rolling', correct: 'A', concept: 'Rolling KE split',
    stem: 'For a solid sphere rolling without slipping, the fraction of its total kinetic energy that is rotational is:',
    options: [['A', '2/7'], ['B', '5/7'], ['C', '2/5'], ['D', '1/2']],
    solution: 'Rotational KE = ½Iω² = (1/5)mv²; Total = ½mv² + (1/5)mv² = (7/10)mv². Ratio = 2/7.',
    keyPoints: [
      'For rolling without slipping, v = ωR links linear and angular motion.',
      'Total KE = translational (½mv²) + rotational (½Iω²).',
      'Solid sphere split: rotational = 2/7, translational = 5/7 of total KE.'],
    note: 'For a rolling solid sphere, remember the 2/7 : 5/7 energy split. Total KE = ½mv²(1 + I/MR²).',
    source: 'SME',
    card: { front: 'Energy split for a rolling solid sphere?', back: 'Rotational : Translational = 2/7 : 5/7. Total KE = ½mv²(1 + I/MR²) = (7/10)mv².' },
    video: { title: 'Rolling motion — kinetic energy breakdown', dur: '4:45' } }
];

const BANK = [
  { n: 1, topics: ['moi'], correct: 'B',
    stem: 'A solid sphere of mass 5 kg and radius 0.2 m. Find its moment of inertia about a tangent to its surface.',
    options: [['A', '0.08 kg·m²'], ['B', '0.28 kg·m²'], ['C', '0.20 kg·m²'], ['D', '0.14 kg·m²']],
    solution: 'I_diameter = (2/5)(5)(0.2²) = 0.08. Tangent: add MR² = 5(0.04) = 0.20 → 0.28 kg·m².',
    maps: [[14, 0.94, 'Same concept — parallel-axis theorem applied to a sphere.']] },
  { n: 2, topics: ['rolling', 'moi'], correct: 'B',
    stem: 'A solid disc and a solid sphere of the same mass and radius roll from rest down the same incline. Which reaches the bottom first?',
    options: [['A', 'The disc'], ['B', 'The sphere'], ['C', 'Both together'], ['D', 'Depends on the angle']],
    solution: 'a = g·sinθ/(1 + I/MR²). The sphere (2/5) has a smaller I/MR² than the disc (1/2), so greater acceleration → it arrives first.',
    maps: [[25, 0.90, 'Rolling dynamics governed by I/MR².'], [14, 0.81, 'Depends on moment of inertia of each body.']] },
  { n: 3, topics: ['torque'], correct: 'A',
    stem: 'A flywheel has a moment of inertia of 4 kg·m² and undergoes an angular acceleration of 3 rad/s². The applied torque is:',
    options: [['A', '12 N·m'], ['B', '7 N·m'], ['C', '1.33 N·m'], ['D', '0.75 N·m']],
    solution: 'τ = Iα = 4 × 3 = 12 N·m.',
    maps: [[18, 0.93, 'Direct application of τ = Iα.']] },
  { n: 5, topics: ['rolling', 'moi'], correct: 'B',
    stem: 'A solid sphere of mass 2 kg and radius 0.1 m rolls without slipping at 3 m/s. Its total kinetic energy is:',
    options: [['A', '9 J'], ['B', '12.6 J'], ['C', '18 J'], ['D', '6.3 J']],
    solution: 'Total KE = ½mv²(1 + 2/5) = ½(2)(9)(7/5) = 12.6 J.',
    maps: [[14, 0.88, 'Needs moment of inertia of a sphere.'], [25, 0.85, 'Rolling kinetic-energy split.']] },
  { n: 6, topics: ['torque'], correct: 'A', solutionOnly: true,
    stem: 'The SI unit of torque is:',
    options: [['A', 'newton-metre (N·m)'], ['B', 'newton per metre (N/m)'], ['C', 'joule-second (J·s)'], ['D', 'newton (N)']],
    solution: 'Torque = force × perpendicular distance, so its SI unit is the newton-metre (N·m).',
    maps: [] }
];

async function seedCourse(db, course, base) {
  const { run } = db;
  const P = s => course + '-' + s;                 // namespace internal ids per course
  const IQID = nn => 'P-' + (base + nn);           // clean, unique index-question codes
  const subjPhy = course + '-phy', subjChem = course + '-chem';

  // chapters — Physics (Rotational Motion = full demo, Kinematics = placeholder) + Chemistry placeholder
  await run('INSERT INTO chapters(id,subject_id,name,ord) VALUES(?,?,?,?)', P('rot'), subjPhy, 'Rotational Motion', 1);
  await run('INSERT INTO chapters(id,subject_id,name,ord) VALUES(?,?,?,?)', P('kin'), subjPhy, 'Kinematics', 2);
  await run('INSERT INTO chapters(id,subject_id,name,ord) VALUES(?,?,?,?)', P('eq'), subjChem, 'Chemical Equilibrium', 1);

  // topics (Rotational Motion)
  for (const [tid, tname] of TOPICS) await run('INSERT INTO topics(id,chapter_id,name) VALUES(?,?,?)', P(tid), P('rot'), tname);

  // index questions + their media
  for (const q of IQ) {
    await run('INSERT INTO index_questions(id,chapter_id,topic_id,stem,options_json,correct_key,concept,solution,key_points_json,note,note_source) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      IQID(q.n), P('rot'), P(q.topic), q.stem, JSON.stringify(q.options), q.correct, q.concept, q.solution, JSON.stringify(q.keyPoints), q.note, q.source);
    await run('INSERT INTO question_media(question_id,question_type,kind,flashcard_front,flashcard_back) VALUES(?,?,?,?,?)', IQID(q.n), 'index', 'flashcard_text', q.card.front, q.card.back);
    await run('INSERT INTO question_media(question_id,question_type,kind,title,duration,file_type) VALUES(?,?,?,?,?,?)', IQID(q.n), 'index', 'video', q.video.title, q.video.dur, 'video');
  }

  // bank questions + approved maps
  for (const b of BANK) {
    await run('INSERT INTO bank_questions(id,chapter_id,topics_json,stem,options_json,correct_key,solution,review_status,no_match,solution_only) VALUES(?,?,?,?,?,?,?,?,?,?)',
      P('B' + b.n), P('rot'), JSON.stringify(b.topics.map(P)), b.stem, JSON.stringify(b.options), b.correct, b.solution, 'done', 0, b.solutionOnly ? 1 : 0);
    for (const m of (b.maps || [])) await run('INSERT INTO question_index_map(bank_question_id,index_question_id,score,status,rationale) VALUES(?,?,?,?,?)', P('B' + b.n), IQID(m[0]), m[1], 'sme_approved', m[2]);
  }
}

async function seedData(db) {
  const { get, run } = db;
  const n = (await get('SELECT CAST(COUNT(*) AS INTEGER) AS c FROM subjects')).c;
  if (n > 0) return false;

  // courses
  await run('INSERT INTO courses(id,name,ord) VALUES(?,?,?)', 'neet', 'NEET', 1);
  await run('INSERT INTO courses(id,name,ord) VALUES(?,?,?)', 'jee', 'JEE', 2);

  // course-scoped subjects (label stays plain to the student)
  const subjects = [
    ['neet-phy', 'neet', 'Physics', 'P', 1], ['neet-chem', 'neet', 'Chemistry', 'C', 2], ['neet-bio', 'neet', 'Biology', 'B', 3],
    ['jee-phy', 'jee', 'Physics', 'P', 1], ['jee-chem', 'jee', 'Chemistry', 'C', 2], ['jee-math', 'jee', 'Mathematics', 'M', 3]
  ];
  for (const s of subjects) await run('INSERT INTO subjects(id,course_id,name,prefix,ord) VALUES(?,?,?,?,?)', ...s);

  // demo content into both courses (NEET codes P-1xx, JEE codes P-2xx)
  await seedCourse(db, 'neet', 100);
  await seedCourse(db, 'jee', 200);

  await run('INSERT INTO students(id,name,email,role) VALUES(?,?,?,?)', 'stu-demo', 'Demo Student', 'demo@indexprep.test', 'student');
  await run('INSERT INTO students(id,name,email,role) VALUES(?,?,?,?)', 'sme-demo', 'Demo SME', 'sme@indexprep.test', 'sme');
  return true;
}

module.exports = { seedData };
