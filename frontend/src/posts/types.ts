export interface Post {
  id: string
  user_name: string
  content: string
  latitude: number | null
  longitude: number | null
  image_url: string | null
  helpful_count: number
  created_at: string
  helpful: boolean
}

export interface PostList {
  items: Post[]
  has_more: boolean
}

export interface CreatePostRequest {
  user_id: string
  content: string
  latitude: number | null
  longitude: number | null
  image_url: string | null
}
