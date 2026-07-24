/* English Tutor LMS — demo dataset (RC2)
 *
 * Builds the seed data the app boots with: parents, students, classes,
 * monthly reviews, homework and the activity feed. Pulled out of the
 * component's state initialiser so that "what data exists" is separate from
 * "how the UI is wired". Pure and deterministic — the same call always returns
 * the same records (variation is driven by a stable string hash), so the demo
 * is identical across reloads.
 *
 * Returns { parents, students, classes, homework, reviews, activity }.
 * Lessons, attendance and billing are derived from these at mount time.
 */
(function (root) {
  var ETLMS = (root.ETLMS = root.ETLMS || {});

  /**
   * Build the deterministic demo dataset the app boots with.
   * @returns {SeedData} parents, students, classes, homework, reviews, activity
   */
  ETLMS.seed = function () {
    const PC = ETLMS.constants.AVATAR_PALETTE;
    const parents=[
      {id:'p1', name:'Jennifer Chen', relationship:'Mother', phone:'(555) 0142', email:'jennifer.chen@email.com', notes:'Prefers WhatsApp for updates.'},
      {id:'p2', name:'David Park', relationship:'Father', phone:'(555) 0198', email:'david.park@email.com', notes:''},
      {id:'p3', name:'Maria Rodriguez', relationship:'Mother', phone:'(555) 0176', email:'maria.r@email.com', notes:'Calls best after 5pm.'},
      {id:'p4', name:'James Kim', relationship:'Father', phone:'(555) 0233', email:'james.kim@email.com', notes:''},
      {id:'p5', name:'Sarah Thompson', relationship:'Mother', phone:'(555) 0311', email:'s.thompson@email.com', notes:'Two children enrolled.'},
      {id:'p6', name:'Robert Nguyen', relationship:'Guardian', phone:'(555) 0288', email:'r.nguyen@email.com', notes:''},
      {id:'p7', name:'Lisa Anderson', relationship:'Mother', phone:'(555) 0355', email:'lisa.a@email.com', notes:''},
      {id:'p8', name:'Michael Wong', relationship:'Father', phone:'(555) 0402', email:'m.wong@email.com', notes:'Exam prep focused.'},
      {id:'p9', name:'Emily Davis', relationship:'Mother', phone:'(555) 0421', email:'emily.davis@email.com', notes:''},
      {id:'p10', name:'Daniel Lee', relationship:'Father', phone:'(555) 0467', email:'daniel.lee@email.com', notes:''},
      {id:'p11', name:'Grace Martin', relationship:'Mother', phone:'(555) 0489', email:'grace.m@email.com', notes:''},
      {id:'p12', name:'Kevin Clark', relationship:'Father', phone:'(555) 0510', email:'kevin.clark@email.com', notes:''},
      {id:'p13', name:'Laura Baker', relationship:'Mother', phone:'(555) 0534', email:'laura.baker@email.com', notes:'Alumni family.'},
    ].map((p,i)=>({...p, initials:p.name.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase(), color:PC[i%PC.length]}));

    const raw=[
      {id:'s1', first:'Emma', last:'Chen', birthday:'2015-03-12', school:'Riverside Elementary', grade:3, parentId:'p1', status:'Active', notes:'Loves reading; strong vocabulary. Preparing for Cambridge Movers.', joined:'2024-09-03', classes:2, attendance:96, balance:0},
      {id:'s2', first:'Lucas', last:'Chen', birthday:'2017-07-08', school:'Riverside Elementary', grade:1, parentId:'p1', status:'Active', notes:'Younger brother of Emma. Energetic, needs varied activities.', joined:'2025-01-14', classes:1, attendance:91, balance:60},
      {id:'s3', first:'Liam', last:'Park', birthday:'2014-11-25', school:'Oakwood Primary', grade:4, parentId:'p2', status:'Active', notes:'Preparing for Cambridge YLE Flyers.', joined:'2024-06-20', classes:2, attendance:98, balance:0},
      {id:'s4', first:'Sophia', last:'Park', birthday:'2016-02-14', school:'Oakwood Primary', grade:2, parentId:'p2', status:'Trial', notes:'Trial student — 2 sessions completed, assessing fit.', joined:'2026-06-28', classes:1, attendance:100, balance:0},
      {id:'s5', first:'Noah', last:'Rodriguez', birthday:'2015-09-30', school:'Sunnyvale School', grade:3, parentId:'p3', status:'Active', notes:'Needs support with pronunciation and confidence.', joined:'2024-10-11', classes:1, attendance:88, balance:120},
      {id:'s6', first:'Ava', last:'Kim', birthday:'2013-06-18', school:'Greenfield Academy', grade:5, parentId:'p4', status:'Active', notes:'Advanced learner; enjoys creative writing.', joined:'2023-09-05', classes:2, attendance:95, balance:0},
      {id:'s7', first:'Olivia', last:'Thompson', birthday:'2016-12-03', school:'Riverside Elementary', grade:2, parentId:'p5', status:'Paused', notes:'On hold — family travelling until August.', joined:'2024-11-02', classes:1, attendance:82, balance:0},
      {id:'s8', first:'Ethan', last:'Thompson', birthday:'2018-04-22', school:'Riverside Elementary', grade:0, parentId:'p5', status:'Active', notes:'Just started phonics. Very keen.', joined:'2025-09-01', classes:1, attendance:90, balance:60},
      {id:'s9', first:'Mia', last:'Nguyen', birthday:'2014-08-17', school:'Oakwood Primary', grade:4, parentId:'p6', status:'Active', notes:'Shy but steadily improving in speaking.', joined:'2024-03-19', classes:2, attendance:93, balance:0},
      {id:'s10', first:'William', last:'Anderson', birthday:'2015-01-09', school:'Sunnyvale School', grade:3, parentId:'p7', status:'Active', notes:'Great at grammar drills; loves quizzes.', joined:'2024-08-12', classes:1, attendance:97, balance:0},
      {id:'s11', first:'Isabella', last:'Wong', birthday:'2013-10-28', school:'Greenfield Academy', grade:5, parentId:'p8', status:'Active', notes:'Confident speaker; KET exam prep.', joined:'2023-11-27', classes:2, attendance:99, balance:0},
      {id:'s12', first:'James', last:'Davis', birthday:'2017-05-15', school:'Maplewood Elementary', grade:1, parentId:'p9', status:'Trial', notes:'Trial — assessing starting level.', joined:'2026-07-01', classes:1, attendance:100, balance:0},
      {id:'s13', first:'Charlotte', last:'Lee', birthday:'2016-09-05', school:'Oakwood Primary', grade:2, parentId:'p10', status:'Paused', notes:'Paused for one month due to exams at school.', joined:'2024-12-08', classes:1, attendance:85, balance:0},
      {id:'s14', first:'Benjamin', last:'Martin', birthday:'2014-03-27', school:'Maplewood Elementary', grade:4, parentId:'p11', status:'Active', notes:'Homework completion is excellent.', joined:'2024-05-16', classes:2, attendance:94, balance:40},
      {id:'s15', first:'Henry', last:'Clark', birthday:'2013-12-20', school:'Greenfield Academy', grade:5, parentId:'p12', status:'Active', notes:'Strong reader; working on writing structure.', joined:'2023-10-03', classes:1, attendance:92, balance:0},
      {id:'s16', first:'Grace', last:'Baker', birthday:'2012-07-07', school:'Greenfield Academy', grade:6, parentId:'p13', status:'Archived', notes:'Graduated to an advanced program. History kept for reference.', joined:'2022-09-01', classes:0, attendance:91, balance:0},
    ];
    const pmap=Object.fromEntries(parents.map(p=>[p.id,p]));
    const age=(b)=>{const d=new Date(b);let a=2026-d.getFullYear();const m=d.getMonth();if(m>6||(m===6&&d.getDate()>10))a--;return a;};
    const students=raw.map((s,i)=>({
      ...s,
      name:s.first+' '+s.last,
      initials:(s.first[0]+s.last[0]).toUpperCase(),
      age:age(s.birthday),
      gradeLabel:s.grade===0?'Kindergarten':'Grade '+s.grade,
      parentName:pmap[s.parentId]?pmap[s.parentId].name:'—',
      phone:pmap[s.parentId]?pmap[s.parentId].phone:'—',
      avatar:null,
      avatarColor:PC[i%PC.length],
    }));

    const CLC = ETLMS.constants.CLASS_PALETTE;
    const classes=[
      {id:'c1', name:'Little Explorers · A1', type:'group', level:'A1 Beginner', fee:800000, classroom:'Room A', status:'Active', studentIds:['s8','s12','s4','s2'], notes:'Phonics-focused. Keep energy high with songs and movement.', schedule:[{day:1,start:'09:00',duration:60}]},
      {id:'c2', name:'Grammar Stars · B1', type:'group', level:'B1 Intermediate', fee:750000, classroom:'Room B', status:'Active', studentIds:['s3','s9','s10','s14'], notes:'Working through the present perfect this month.', schedule:[{day:3,start:'16:00',duration:60},{day:5,start:'10:00',duration:60}]},
      {id:'c3', name:'Reading Rockets · A2', type:'group', level:'A2 Elementary', fee:700000, classroom:'Room A', status:'Active', studentIds:['s5','s7','s13'], notes:'Guided reading and comprehension games.', schedule:[{day:6,start:'10:00',duration:75}]},
      {id:'c4', name:'Emma Chen · 1-on-1', type:'one-on-one', level:'Intermediate', fee:1500000, classroom:'Room C', status:'Active', studentIds:['s1'], notes:'Cambridge Movers prep. Focus on speaking fluency.', schedule:[{day:2,start:'14:30',duration:45}]},
      {id:'c5', name:'Liam Park · 1-on-1', type:'one-on-one', level:'YLE Flyers', fee:1500000, classroom:'Room C', status:'Active', studentIds:['s3'], notes:'', schedule:[{day:4,start:'15:00',duration:45}]},
      {id:'c6', name:'Isabella Wong · KET Prep', type:'one-on-one', level:'B1 Exam', fee:1800000, classroom:'Room C', status:'Active', studentIds:['s11'], notes:'KET exam in September — practice full past papers.', schedule:[{day:4,start:'17:00',duration:60}]},
      {id:'c7', name:'Creative Writers · B2', type:'group', level:'B2 Upper', fee:900000, classroom:'Room B', status:'Archived', studentIds:['s6','s15'], notes:'Paused over the summer break.', schedule:[{day:5,start:'16:30',duration:90}]},
    ].map((c,i)=>({...c, color:CLC[i%CLC.length]}));

    // ===== Homework & Reviews mock data =====
    // RC2 Fix A: consume the shared hash + skill list instead of re-declaring them.
    const _h4=ETLMS.calc.hash;
    const SKL4=ETLMS.constants.SKILLS.map(x=>x[0]);
    const SKLL4=Object.fromEntries(ETLMS.constants.SKILLS);
    const cap4=(w)=>w.charAt(0).toUpperCase()+w.slice(1);
    // -- reviews (recent 3 months) --
    const rvMonths=['2026-04','2026-05','2026-06'];
    const cmtT=[
      '{n} has had a productive month. {sk} continues to be a real strength, and every lesson is met with focus and curiosity.',
      'A steady, encouraging month for {n}. There is clear growth in {sk}, and confidence in class keeps building.',
      '{n} approaches learning with genuine enthusiasm. {sk} stands out this month; with continued practice the rest will follow.',
      'This month {n} showed lovely progress. {sk} is developing nicely and participation has been consistently strong.'];
    const strT=['Excellent {sk}; asks thoughtful questions and retains new vocabulary quickly.','A focused, positive attitude in every session and a genuine willingness to try new language.','A confident learner who is happy to take risks and learn from mistakes.'];
    const impT=['Would benefit from a little more regular writing practice at home.','Working on slowing down to self-correct grammar while speaking.','Building the confidence to answer in full sentences without prompting.'];
    const goalT=['Complete the practice set and read one short story each week.','Write a five-sentence paragraph independently; learn 20 new topic words.','Speak for one minute on a familiar topic without long pauses.'];
    const reviews=[];
    students.filter(s=>s.status!=='Archived').forEach(s=>{
      const base= s.attendance>=95?4.1 : s.attendance>=90?3.6 : s.attendance>=85?3.1 : 2.7;
      rvMonths.forEach((mo,mi)=>{
        if(mi<2 && _h4(s.id+mo)%3===0) return;
        const skills={}; SKL4.forEach(k=>{ let v=Math.round(base + ((_h4(s.id+k+mo)%9)/10-0.4) + mi*0.18); skills[k]=Math.max(1,Math.min(5,v)); });
        const top=SKL4.slice().sort((a,b)=>skills[b]-skills[a])[0]; const nm=s.first;
        reviews.push({ id:'rv-'+s.id+'-'+mo, studentId:s.id, month:mo, skills,
          comment:cmtT[_h4(s.id+mo)%cmtT.length].replace('{n}',nm).replace('{sk}',cap4(SKLL4[top])),
          strengths:strT[_h4(s.id+'s'+mo)%strT.length].replace('{sk}',SKLL4[top].toLowerCase()),
          improvements:impT[_h4(s.id+'i'+mo)%impT.length],
          goals:goalT[_h4(s.id+'g'+mo)%goalT.length],
          parentNotes: mi===2? ('Please encourage '+nm+' to read aloud for ten minutes each evening — it is making a real difference. Thank you for your support at home.') : '' });
      });
    });
    // -- homework --
    const hwT=[
      {t:'Reading comprehension · Unit 5',d:'Read pages 22–25 and answer questions 1–8. Focus on finding the main idea of each paragraph.'},
      {t:'Vocabulary — Animals & Habitats',d:'Learn the 15 new words on the flashcards. Write a sentence for any five of them.'},
      {t:'Grammar worksheet · Present Perfect',d:'Complete worksheet 3B. Remember the difference between "for" and "since".'},
      {t:'Speaking journal',d:'Record a one-minute voice note describing your weekend. Use at least three past-tense verbs.'},
      {t:'Writing task — My favourite place',d:'Write a short paragraph (5–6 sentences) about a place you love. Bring it to the next lesson.'},
      {t:'Listening practice · Track 12',d:'Listen to the audio twice and complete the gap-fill on page 30.'},
      {t:'Phonics review',d:'Practise the "sh" and "ch" sound cards for ten minutes, then read the story on page 8 aloud.'},
      {t:'Exam practice — Reading Part 2',d:'Complete one past-paper reading section and check your answers with the key.'}];
    const hwPool=['Completed','Completed','Completed','Late','Missing'];
    const hwSpan=['2026-06-20','2026-06-24','2026-06-27','2026-07-01','2026-07-04','2026-07-08','2026-07-11','2026-07-15','2026-07-18'];
    const homework=[];
    classes.filter(c=>c.status!=='Archived').forEach(c=>{
      const n=2+(_h4(c.id)%2);
      for(let i=0;i<n;i++){
        const tpl=hwT[_h4(c.id+'h'+i)%hwT.length];
        const due=hwSpan[_h4(c.id+'due'+i)%hwSpan.length];
        const future=due>'2026-07-10';
        const enrolled=c.studentIds.slice();
        const scope=(enrolled.length && _h4(c.id+'sc'+i)%4===0)?'student':'class';
        const stu= scope==='student'? enrolled[_h4(c.id+'st'+i)%enrolled.length] : null;
        const submissions={};
        (scope==='class'?enrolled:[]).forEach(sid=>{ submissions[sid]= future?'Assigned': hwPool[_h4(sid+c.id+i)%hwPool.length]; });
        let status;
        if(future) status='Assigned';
        else if(scope==='student') status=hwPool[_h4(stu+c.id+i)%hwPool.length];
        else { const vals=Object.values(submissions); const miss=vals.filter(v=>v==='Missing').length, late=vals.filter(v=>v==='Late').length; status= miss>vals.length/3?'Missing': late>vals.length/3?'Late':'Completed'; }
        homework.push({ id:'hw-'+c.id+'-'+i, title:tpl.t, description:tpl.d, classId:c.id, lessonId:null, scope, studentId:stu, dueDate:due, status, submissions, teacherNotes:'', createdAt:'2026-06-15' });
      }
    });
    homework.sort((a,b)=>b.dueDate.localeCompare(a.dueDate));

    const activity=[
      {id:'sa1',type:'attendance',pre:'Attendance saved for ',strong:'Little Explorers · A1',post:'',ago:'12 min ago'},
      {id:'sa2',type:'payment',pre:'Payment recorded — ',strong:'450,000đ',post:' from Emma Chen',ago:'1 hour ago'},
      {id:'sa3',type:'review',pre:'Monthly review published for ',strong:'Emma Chen',post:'',ago:'3 hours ago'},
      {id:'sa4',type:'homework',pre:'Homework assigned to ',strong:'Grammar Stars · B1',post:'',ago:'Yesterday'},
      {id:'sa5',type:'student',pre:'New student ',strong:'James Davis',post:' added',ago:'Yesterday'},
      {id:'sa6',type:'makeup',pre:'Lesson rescheduled for ',strong:'Reading Rockets · A2',post:'',ago:'2 days ago'},
    ];

    return { parents, students, classes, homework, reviews, activity };
  };
})(window);
