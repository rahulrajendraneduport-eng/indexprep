'use strict';
/* Shared seed data. Uses only portable SQL + the async db interface,
   so it works identically on SQLite (local) and Postgres (production). */

async function seedData(db) {
  const { get, run } = db;
  const n = (await get('SELECT CAST(COUNT(*) AS INTEGER) AS c FROM subjects')).c;
  if (n > 0) return false;

  const subjects = [['phy', 'Physics', 'P'], ['chem', 'Chemistry', 'C'], ['bio', 'Biology', 'B'], ['math', 'Mathematics', 'M']];
  for (const s of subjects) await run('INSERT INTO subjects(id,name,prefix) VALUES(?,?,?)', ...s);

  const chapters = [['rot', 'phy', 'Rotational Motion', 1], ['kin', 'phy', 'Kinematics', 2], ['eq', 'chem', 'Chemical Equilibrium', 1]];
  for (const c of chapters) await run('INSERT INTO chapters(id,subject_id,name,ord) VALUES(?,?,?,?)', ...c);

  const topics = [
    ['moi', 'rot', 'Moment of Inertia'], ['torque', 'rot', 'Torque'], ['angmom', 'rot', 'Angular Momentum'],
    ['rolling', 'rot', 'Rolling Motion'], ['angkin', 'rot', 'Angular Kinematics']
  ];
  for (const t of topics) await run('INSERT INTO topics(id,chapter_id,name) VALUES(?,?,?)', ...t);

  const IQ = [
    ['P-114', 'rot', 'moi', 'The moment of inertia of a uniform solid sphere (mass M, radius R) about its diameter is (2/5)MR². Its moment of inertia about a tangent to its surface is:',
      [['A', '(7/5)MR²'], ['B', '(2/5)MR²'], ['C', '(5/2)MR²'], ['D', '(3/5)MR²']], 'A', 'Parallel-axis theorem',
      'Parallel-axis theorem: I = I_cm + Md². Here d = R, so I = (2/5)MR² + MR² = (7/5)MR².',
      ['Parallel-axis theorem: I = I_cm + Md², where d is the distance from the centre of mass to the new axis.',
       'For a tangent to a sphere, d = R — so you ADD MR² to the about-diameter value.',
       'Solid sphere: about diameter = (2/5)MR², about tangent = (7/5)MR².'],
      'Whenever the axis is shifted away from the centre of mass, add Md². Forgetting this term is the single most common mistake here.', 'AI'],
    ['P-118', 'rot', 'torque', 'A torque of 10 N·m acts on a rigid body whose moment of inertia is 2 kg·m². Its angular acceleration is:',
      [['A', '5 rad/s²'], ['B', '20 rad/s²'], ['C', '2.5 rad/s²'], ['D', '0.2 rad/s²']], 'A', 'Torque = Iα',
      'τ = Iα → α = τ/I = 10/2 = 5 rad/s².',
      ['The rotational analogue of F = ma is τ = Iα.', 'Angular acceleration α = τ / I.', 'Units: τ in N·m, I in kg·m², α in rad/s².'],
      'τ = Iα is the master equation for rotational dynamics — always identify the torque and the moment of inertia first.', 'SME'],
    ['P-121', 'rot', 'angmom', 'A skater pulls her arms in, halving her moment of inertia. With no external torque, her angular velocity:',
      [['A', 'Doubles'], ['B', 'Halves'], ['C', 'Stays the same'], ['D', 'Quadruples']], 'A', 'Conservation of angular momentum',
      'L = Iω is conserved. If I becomes I/2, then ω must double to keep Iω constant.',
      ['With no external torque, angular momentum L = Iω is conserved.', 'If I decreases, ω increases in proportion (and vice versa).', 'Halving I doubles ω; tripling I makes ω one-third.'],
      'Spot the phrase "no external torque" → use L = Iω = constant. The spinning skater pulling her arms in is the mental picture.', 'AI'],
    ['P-125', 'rot', 'rolling', 'For a solid sphere rolling without slipping, the fraction of its total kinetic energy that is rotational is:',
      [['A', '2/7'], ['B', '5/7'], ['C', '2/5'], ['D', '1/2']], 'A', 'Rolling KE split',
      'Rotational KE = ½Iω² = (1/5)mv²; Total = ½mv² + (1/5)mv² = (7/10)mv². Ratio = 2/7.',
      ['For rolling without slipping, v = ωR links linear and angular motion.', 'Total KE = translational (½mv²) + rotational (½Iω²).', 'Solid sphere split: rotational = 2/7, translational = 5/7 of total KE.'],
      'For a rolling solid sphere, remember the 2/7 : 5/7 energy split. Total KE = ½mv²(1 + I/MR²).', 'SME']
  ];
  for (const q of IQ) await run(
    'INSERT INTO index_questions(id,chapter_id,topic_id,stem,options_json,correct_key,concept,solution,key_points_json,note,note_source) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    q[0], q[1], q[2], q[3], JSON.stringify(q[4]), q[5], q[6], q[7], JSON.stringify(q[8]), q[9], q[10]);

  const media = [
    ['P-114', 'Moment of inertia of a solid sphere about a tangent?', 'I_tangent = I_cm + MR² = (2/5)MR² + MR² = (7/5)MR². The extra +MR² comes straight from the parallel-axis theorem.', 'Parallel-axis theorem — derivation & worked examples', '4:12'],
    ['P-118', 'Rotational form of Newton’s second law?', 'τ = Iα. Torque plays the role of force, moment of inertia the role of mass, and angular acceleration the role of acceleration.', 'Torque and angular acceleration explained', '3:28'],
    ['P-121', 'When is angular momentum conserved?', 'When the net external torque is zero. Then L = Iω stays constant, so if I decreases, ω increases.', 'Conservation of angular momentum — the skater effect', '5:03'],
    ['P-125', 'Energy split for a rolling solid sphere?', 'Rotational : Translational = 2/7 : 5/7. Total KE = ½mv²(1 + I/MR²) = (7/10)mv².', 'Rolling motion — kinetic energy breakdown', '4:45']
  ];
  for (const m of media) {
    await run('INSERT INTO question_media(question_id,question_type,kind,flashcard_front,flashcard_back) VALUES(?,?,?,?,?)', m[0], 'index', 'flashcard_text', m[1], m[2]);
    await run('INSERT INTO question_media(question_id,question_type,kind,title,duration,file_type) VALUES(?,?,?,?,?,?)', m[0], 'index', 'video', m[3], m[4], 'video');
  }

  const BANK = [
    ['B1', 'rot', ['moi'], 'A solid sphere of mass 5 kg and radius 0.2 m. Find its moment of inertia about a tangent to its surface.',
      [['A', '0.08 kg·m²'], ['B', '0.28 kg·m²'], ['C', '0.20 kg·m²'], ['D', '0.14 kg·m²']], 'B',
      'I_diameter = (2/5)(5)(0.2²) = 0.08. Tangent: add MR² = 5(0.04) = 0.20 → 0.28 kg·m².', 'done', 0, 0,
      [['P-114', 0.94, 'sme_approved', 'Same concept — parallel-axis theorem applied to a sphere.']]],
    ['B2', 'rot', ['rolling', 'moi'], 'A solid disc and a solid sphere of the same mass and radius roll from rest down the same incline. Which reaches the bottom first?',
      [['A', 'The disc'], ['B', 'The sphere'], ['C', 'Both together'], ['D', 'Depends on the angle']], 'B',
      'a = g·sinθ/(1 + I/MR²). The sphere (2/5) has a smaller I/MR² than the disc (1/2), so greater acceleration → it arrives first.', 'done', 0, 0,
      [['P-125', 0.90, 'sme_approved', 'Rolling dynamics governed by I/MR².'], ['P-114', 0.81, 'sme_approved', 'Depends on moment of inertia of each body.']]],
    ['B3', 'rot', ['torque'], 'A flywheel has a moment of inertia of 4 kg·m² and undergoes an angular acceleration of 3 rad/s². The applied torque is:',
      [['A', '12 N·m'], ['B', '7 N·m'], ['C', '1.33 N·m'], ['D', '0.75 N·m']], 'A',
      'τ = Iα = 4 × 3 = 12 N·m.', 'done', 0, 0, [['P-118', 0.93, 'sme_approved', 'Direct application of τ = Iα.']]],
    ['B5', 'rot', ['rolling', 'moi'], 'A solid sphere of mass 2 kg and radius 0.1 m rolls without slipping at 3 m/s. Its total kinetic energy is:',
      [['A', '9 J'], ['B', '12.6 J'], ['C', '18 J'], ['D', '6.3 J']], 'B',
      'Total KE = ½mv²(1 + 2/5) = ½(2)(9)(7/5) = 12.6 J.', 'done', 0, 0,
      [['P-114', 0.88, 'sme_approved', 'Needs moment of inertia of a sphere.'], ['P-125', 0.85, 'sme_approved', 'Rolling kinetic-energy split.']]],
    ['B6', 'rot', ['torque'], 'The SI unit of torque is:',
      [['A', 'newton-metre (N·m)'], ['B', 'newton per metre (N/m)'], ['C', 'joule-second (J·s)'], ['D', 'newton (N)']], 'A',
      'Torque = force × perpendicular distance, so its SI unit is the newton-metre (N·m).', 'done', 0, 1, []]
  ];
  for (const b of BANK) {
    await run('INSERT INTO bank_questions(id,chapter_id,topics_json,stem,options_json,correct_key,solution,review_status,no_match,solution_only) VALUES(?,?,?,?,?,?,?,?,?,?)',
      b[0], b[1], JSON.stringify(b[2]), b[3], JSON.stringify(b[4]), b[5], b[6], b[7], b[8], b[9]);
    for (const m of (b[10] || [])) await run('INSERT INTO question_index_map(bank_question_id,index_question_id,score,status,rationale) VALUES(?,?,?,?,?)', b[0], m[0], m[1], m[2], m[3]);
  }

  await run('INSERT INTO students(id,name,email,role) VALUES(?,?,?,?)', 'stu-demo', 'Demo Student', 'demo@indexprep.test', 'student');
  await run('INSERT INTO students(id,name,email,role) VALUES(?,?,?,?)', 'sme-demo', 'Demo SME', 'sme@indexprep.test', 'sme');
  return true;
}

module.exports = { seedData };
