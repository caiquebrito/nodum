export interface User {
  id: string;
  email: string;
  password: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Post {
  id: string;
  title: string;
  content: string;
  authorId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Comment {
  id: string;
  content: string;
  postId: string;
  authorId: string;
  createdAt: Date;
}

export class UserRepository {
  async findById(id: string): Promise<User | null> {
    // Implementation
    return null;
  }

  async findByEmail(email: string): Promise<User | null> {
    // Implementation
    return null;
  }

  async create(user: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User> {
    // Implementation
    return {} as User;
  }

  async update(id: string, data: Partial<User>): Promise<User> {
    // Implementation
    return {} as User;
  }
}

export class PostRepository {
  async findById(id: string): Promise<Post | null> {
    return null;
  }

  async findByAuthor(authorId: string): Promise<Post[]> {
    return [];
  }

  async create(post: Omit<Post, 'id' | 'createdAt' | 'updatedAt'>): Promise<Post> {
    return {} as Post;
  }
}

export class CommentRepository {
  async findByPost(postId: string): Promise<Comment[]> {
    return [];
  }

  async create(comment: Omit<Comment, 'id' | 'createdAt'>): Promise<Comment> {
    return {} as Comment;
  }
}
