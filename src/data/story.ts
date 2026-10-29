// Story of the open world. Chapters unlock as you level up; the intro shows on the landing page and at spawn.

export const STORY = {
  title: 'The Infinite Road',
  intro:
    'The island of Infinita was a rider\'s paradise until Vex Corp switched on its drone swarm and fenced the roads off. ' +
    'You found an old bike in a beach shack. Ride, collect energy gems, smash the blockades and take the roads back.',
  spawn: { title: 'CHAPTER 1 · THE SHACK', text: 'Walk to your bike (E) and hit the road.' },
  chapters: [
    { level: 2, title: 'CHAPTER 2 · FIRST SPARKS', text: 'Rockets unlocked. Vex scouts noticed you. Knock them out of the sky.' },
    { level: 3, title: 'CHAPTER 3 · THE RAIL', text: 'Railgun online. Gunner drones patrol the crossroads: pierce them.' },
    { level: 4, title: 'CHAPTER 4 · SWARM', text: 'Homing swarm missiles ready. Bombers are coming: keep moving.' },
    { level: 5, title: 'CHAPTER 5 · MINEFIELD', text: 'Drop mines behind you and lure the swarm in.' },
    { level: 7, title: 'CHAPTER 6 · DEEP ROADS', text: 'Ride far from the shack. The further you go, the harder Vex fights back.' },
    { level: 10, title: 'CHAPTER 7 · LEGEND', text: 'Infinita\'s roads are free. Keep riding, the road never ends.' },
  ],
  race: { title: 'CIRCUIT', text: 'Hit every checkpoint gate in order. Beat your ghost.' },
};
