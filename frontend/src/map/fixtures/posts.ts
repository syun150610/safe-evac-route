export interface MockPost {
  id: string
  author: string
  body: string
  age: string
  reactions: number
}

export const POSTS: MockPost[] = [
  {
    id: 'post-1',
    author: '田中 太郎',
    body: '道路が冠水気味です。駅側により歩道が一部通りにくくなっています。車椅子の方は注意してください。',
    age: '2分前',
    reactions: 12,
  },
  {
    id: 'post-2',
    author: '佐藤 花子',
    body: '上野小学校の入口は東側から入れます。',
    age: '8分前',
    reactions: 7,
  },
]
