# Technical Specifications
## Frontend Implementation Details

### 1. State Management Architecture

#### 1.1 Global State Structure (Zustand)
```typescript
interface GlobalState {
  // User Authentication
  user: {
    id: string;
    email: string;
    name: string;
    role: 'student' | 'instructor' | 'admin';
    subscription: 'free' | 'premium' | 'enterprise';
    avatar?: string;
    preferences: UserPreferences;
  } | null;

  // Course Progress
  progress: {
    [courseId: string]: {
      enrolledAt: Date;
      completedLessons: string[];
      currentLesson: string;
      completionPercentage: number;
      assessmentScores: { [assessmentId: string]: number };
      timeSpent: number; // in minutes
      lastAccessedAt: Date;
    };
  };

  // Achievements & Gamification
  achievements: {
    badges: Badge[];
    streaks: {
      current: number;
      longest: number;
      lastActivity: Date;
    };
    xp: number;
    level: number;
  };

  // UI State
  ui: {
    theme: 'light' | 'dark' | 'system';
    sidebarCollapsed: boolean;
    notifications: Notification[];
    loading: { [key: string]: boolean };
    errors: { [key: string]: string };
  };
}
```

#### 1.2 Server State Management (React Query)
```typescript
// Course Data Queries
const useCourses = () => useQuery({
  queryKey: ['courses'],
  queryFn: () => api.courses.getAll(),
  staleTime: 10 * 60 * 1000, // 10 minutes
});

const useCourse = (id: string) => useQuery({
  queryKey: ['course', id],
  queryFn: () => api.courses.getById(id),
  enabled: !!id,
});

// Progress Mutations
const useUpdateProgress = () => useMutation({
  mutationFn: (data: ProgressUpdate) => api.progress.update(data),
  onSuccess: (data) => {
    queryClient.setQueryData(['progress', data.courseId], data);
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  },
});

// Assessment Submissions
const useSubmitAssessment = () => useMutation({
  mutationFn: (submission: AssessmentSubmission) => 
    api.assessments.submit(submission),
  onSuccess: (result) => {
    // Update progress
    queryClient.invalidateQueries({ queryKey: ['progress'] });
    // Update achievements
    queryClient.invalidateQueries({ queryKey: ['achievements'] });
  },
});
```

#### 1.3 Form State Management (React Hook Form)
```typescript
// Course Enrollment Form
const useEnrollmentForm = () => {
  const form = useForm<EnrollmentForm>({
    resolver: zodResolver(enrollmentSchema),
    defaultValues: {
      courseId: '',
      paymentMethod: 'credit_card',
      agreeToTerms: false,
    },
  });

  const enrollMutation = useEnrollment();

  const onSubmit = async (data: EnrollmentForm) => {
    try {
      await enrollMutation.mutateAsync(data);
      toast.success('Successfully enrolled!');
      router.push(`/courses/${data.courseId}`);
    } catch (error) {
      toast.error('Enrollment failed. Please try again.');
    }
  };

  return { form, onSubmit, isLoading: enrollMutation.isLoading };
};
```

### 2. Component Implementation Specifications

#### 2.1 Course Card Component
```typescript
interface CourseCardProps {
  course: Course;
  progress?: CourseProgress;
  size?: 'small' | 'medium' | 'large';
  onClick?: () => void;
  className?: string;
}

const CourseCard: React.FC<CourseCardProps> = ({
  course,
  progress,
  size = 'medium',
  onClick,
  className,
}) => {
  const progressPercentage = progress?.completionPercentage || 0;
  const isCompleted = progressPercentage === 100;
  const isLocked = course.prerequisites?.some(id => 
    !userProgress[id]?.completed
  );

  return (
    <div
      className={cn(
        'group cursor-pointer rounded-lg border bg-card p-6 transition-all',
        'hover:shadow-md focus-within:ring-2 focus-within:ring-primary',
        {
          'opacity-50': isLocked,
          'border-green-200 bg-green-50': isCompleted,
        },
        className
      )}
      onClick={!isLocked ? onClick : undefined}
      role="button"
      tabIndex={0}
      aria-label={`${course.title} - ${
        isLocked ? 'Locked' : isCompleted ? 'Completed' : 'Available'
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-card-foreground">
            {course.title}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {course.description}
          </p>
        </div>
        <div className="ml-4 flex items-center">
          {isLocked && <Lock className="h-5 w-5 text-muted-foreground" />}
          {isCompleted && <Check className="h-5 w-5 text-green-600" />}
        </div>
      </div>
      
      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            {course.duration}
          </span>
        </div>
        <div className="flex items-center space-x-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            {course.enrollmentCount}
          </span>
        </div>
      </div>

      {progress && (
        <div className="mt-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Progress</span>
            <span className="font-medium">{progressPercentage}%</span>
          </div>
          <Progress value={progressPercentage} className="mt-2" />
        </div>
      )}
    </div>
  );
};
```

#### 2.2 Assessment Component
```typescript
interface AssessmentProps {
  assessment: Assessment;
  onSubmit: (answers: AssessmentAnswers) => void;
  onSave?: (answers: AssessmentAnswers) => void;
  className?: string;
}

const Assessment: React.FC<AssessmentProps> = ({
  assessment,
  onSubmit,
  onSave,
  className,
}) => {
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answers, setAnswers] = useState<AssessmentAnswers>({});
  const [timeRemaining, setTimeRemaining] = useState(assessment.timeLimit);

  // Timer logic
  useEffect(() => {
    if (timeRemaining <= 0) {
      handleSubmit();
      return;
    }

    const timer = setInterval(() => {
      setTimeRemaining(prev => prev - 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [timeRemaining]);

  const handleAnswerChange = (questionId: string, answer: any) => {
    setAnswers(prev => ({ ...prev, [questionId]: answer }));
    onSave?.({ ...answers, [questionId]: answer });
  };

  const handleSubmit = () => {
    onSubmit(answers);
  };

  const question = assessment.questions[currentQuestion];
  const progress = ((currentQuestion + 1) / assessment.questions.length) * 100;

  return (
    <div className={cn('space-y-6', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">{assessment.title}</h2>
        <div className="flex items-center space-x-4">
          <div className="text-sm text-muted-foreground">
            Time: {formatTime(timeRemaining)}
          </div>
          <div className="text-sm font-medium">
            {currentQuestion + 1} of {assessment.questions.length}
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <Progress value={progress} className="w-full" />

      {/* Question */}
      <div className="space-y-4">
        <QuestionComponent
          question={question}
          answer={answers[question.id]}
          onChange={(answer) => handleAnswerChange(question.id, answer)}
        />
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={() => setCurrentQuestion(prev => Math.max(0, prev - 1))}
          disabled={currentQuestion === 0}
        >
          Previous
        </Button>
        
        <div className="flex space-x-2">
          {assessment.questions.map((_, index) => (
            <Button
              key={index}
              variant={index === currentQuestion ? "default" : "outline"}
              size="sm"
              onClick={() => setCurrentQuestion(index)}
              className={cn(
                'w-8 h-8 p-0',
                answers[assessment.questions[index].id] && 'bg-green-100'
              )}
            >
              {index + 1}
            </Button>
          ))}
        </div>

        {currentQuestion === assessment.questions.length - 1 ? (
          <Button onClick={handleSubmit} disabled={!allQuestionsAnswered}>
            Submit Assessment
          </Button>
        ) : (
          <Button
            onClick={() => setCurrentQuestion(prev => 
              Math.min(assessment.questions.length - 1, prev + 1)
            )}
          >
            Next
          </Button>
        )}
      </div>
    </div>
  );
};
```

#### 2.3 Video Player Component
```typescript
interface VideoPlayerProps {
  src: string;
  poster?: string;
  onProgress?: (progress: VideoProgress) => void;
  onComplete?: () => void;
  chapters?: Chapter[];
  transcript?: TranscriptItem[];
  className?: string;
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({
  src,
  poster,
  onProgress,
  onComplete,
  chapters,
  transcript,
  className,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [showTranscript, setShowTranscript] = useState(false);

  // Progress tracking
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      const current = video.currentTime;
      const total = video.duration;
      setCurrentTime(current);
      
      onProgress?.({
        currentTime: current,
        duration: total,
        percentage: (current / total) * 100,
      });
    };

    const handleLoadedMetadata = () => {
      setDuration(video.duration);
    };

    const handleEnded = () => {
      setIsPlaying(false);
      onComplete?.();
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('ended', handleEnded);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('ended', handleEnded);
    };
  }, [onProgress, onComplete]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
    } else {
      video.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleSeek = (time: number) => {
    const video = videoRef.current;
    if (!video) return;
    
    video.currentTime = time;
    setCurrentTime(time);
  };

  const changePlaybackRate = (rate: number) => {
    const video = videoRef.current;
    if (!video) return;
    
    video.playbackRate = rate;
    setPlaybackRate(rate);
  };

  return (
    <div className={cn('relative bg-black rounded-lg overflow-hidden', className)}>
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        className="w-full h-full"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
      />
      
      {/* Custom Controls */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4">
        <div className="space-y-2">
          {/* Progress Bar */}
          <div className="flex items-center space-x-2">
            <span className="text-white text-sm">{formatTime(currentTime)}</span>
            <Slider
              value={[currentTime]}
              max={duration}
              step={1}
              onValueChange={([value]) => handleSeek(value)}
              className="flex-1"
            />
            <span className="text-white text-sm">{formatTime(duration)}</span>
          </div>
          
          {/* Control Buttons */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={togglePlay}
                className="text-white hover:text-white"
              >
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </Button>
              
              <Select value={playbackRate.toString()} onValueChange={(value) => changePlaybackRate(Number(value))}>
                <SelectTrigger className="w-20 bg-transparent border-white/20 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0.5">0.5x</SelectItem>
                  <SelectItem value="0.75">0.75x</SelectItem>
                  <SelectItem value="1">1x</SelectItem>
                  <SelectItem value="1.25">1.25x</SelectItem>
                  <SelectItem value="1.5">1.5x</SelectItem>
                  <SelectItem value="2">2x</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex items-center space-x-2">
              {transcript && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowTranscript(!showTranscript)}
                  className="text-white hover:text-white"
                >
                  <MessageSquare className="h-4 w-4" />
                </Button>
              )}
              
              <Button
                variant="ghost"
                size="sm"
                onClick={() => videoRef.current?.requestFullscreen()}
                className="text-white hover:text-white"
              >
                <Maximize className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
      
      {/* Chapters Overlay */}
      {chapters && (
        <div className="absolute top-4 right-4">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="text-white">
                <List className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {chapters.map((chapter) => (
                <DropdownMenuItem
                  key={chapter.id}
                  onClick={() => handleSeek(chapter.startTime)}
                >
                  {chapter.title}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      
      {/* Transcript */}
      {showTranscript && transcript && (
        <div className="absolute bottom-20 left-4 right-4 bg-black/80 rounded-lg p-4 max-h-40 overflow-y-auto">
          <div className="space-y-2">
            {transcript.map((item, index) => (
              <div
                key={index}
                className={cn(
                  'text-white text-sm cursor-pointer hover:bg-white/20 p-2 rounded',
                  currentTime >= item.startTime && currentTime < item.endTime && 'bg-white/20'
                )}
                onClick={() => handleSeek(item.startTime)}
              >
                {item.text}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
```

### 3. Performance Optimization Strategies

#### 3.1 Code Splitting
```typescript
// Route-based code splitting
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Course = lazy(() => import('./pages/Course'));
const Assessment = lazy(() => import('./pages/Assessment'));

// Component-based code splitting
const VideoPlayer = lazy(() => import('./components/VideoPlayer'));
const CodeEditor = lazy(() => import('./components/CodeEditor'));

// Suspense boundaries
const App = () => (
  <BrowserRouter>
    <Suspense fallback={<LoadingSpinner />}>
      <Routes>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/course/:id" element={<Course />} />
        <Route path="/assessment/:id" element={<Assessment />} />
      </Routes>
    </Suspense>
  </BrowserRouter>
);
```

#### 3.2 Memoization Strategy
```typescript
// Component memoization
const CourseCard = memo(({ course, progress }) => {
  // Component logic
}, (prevProps, nextProps) => {
  return prevProps.course.id === nextProps.course.id &&
         prevProps.progress?.completionPercentage === nextProps.progress?.completionPercentage;
});

// Value memoization
const useCourseStats = (courses: Course[]) => {
  return useMemo(() => {
    return {
      totalCourses: courses.length,
      completedCourses: courses.filter(c => c.isCompleted).length,
      inProgressCourses: courses.filter(c => c.isInProgress).length,
      averageRating: courses.reduce((sum, c) => sum + c.rating, 0) / courses.length,
    };
  }, [courses]);
};

// Callback memoization
const useOptimizedHandlers = (courseId: string) => {
  const updateProgress = useUpdateProgress();
  
  const handleLessonComplete = useCallback((lessonId: string) => {
    updateProgress.mutate({ courseId, lessonId, completed: true });
  }, [courseId, updateProgress]);
  
  return { handleLessonComplete };
};
```

#### 3.3 Virtual Scrolling Implementation
```typescript
const VirtualizedCourseList = ({ courses }: { courses: Course[] }) => {
  const parentRef = useRef<HTMLDivElement>(null);
  
  const { virtualItems, totalSize } = useVirtualizer({
    count: courses.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 200, // Estimated height of each course card
    overscan: 5,
  });

  return (
    <div ref={parentRef} className="h-96 overflow-auto">
      <div
        style={{
          height: `${totalSize}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualItems.map((virtualItem) => (
          <div
            key={virtualItem.index}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: `${virtualItem.size}px`,
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            <CourseCard course={courses[virtualItem.index]} />
          </div>
        ))}
      </div>
    </div>
  );
};
```

### 4. Accessibility Implementation

#### 4.1 Keyboard Navigation
```typescript
const AccessibleNavigation = () => {
  const [focusedIndex, setFocusedIndex] = useState(0);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);

  const handleKeyDown = (e: KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusedIndex(prev => Math.min(prev + 1, items.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedIndex(prev => Math.max(prev - 1, 0));
        break;
      case 'Home':
        e.preventDefault();
        setFocusedIndex(0);
        break;
      case 'End':
        e.preventDefault();
        setFocusedIndex(items.length - 1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        itemRefs.current[focusedIndex]?.click();
        break;
    }
  };

  useEffect(() => {
    itemRefs.current[focusedIndex]?.focus();
  }, [focusedIndex]);

  return (
    <div
      role="menu"
      onKeyDown={handleKeyDown}
      className="space-y-2"
    >
      {items.map((item, index) => (
        <div
          key={item.id}
          ref={el => itemRefs.current[index] = el}
          role="menuitem"
          tabIndex={index === focusedIndex ? 0 : -1}
          className="focus:ring-2 focus:ring-primary focus:outline-none"
          onClick={() => handleItemClick(item)}
        >
          {item.title}
        </div>
      ))}
    </div>
  );
};
```

#### 4.2 Screen Reader Support
```typescript
const AccessibleProgressBar = ({ value, max, label }: {
  value: number;
  max: number;
  label: string;
}) => {
  const percentage = Math.round((value / max) * 100);
  
  return (
    <div className="space-y-2">
      <div className="flex justify-between">
        <span id="progress-label">{label}</span>
        <span aria-live="polite">{percentage}%</span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-labelledby="progress-label"
        aria-describedby="progress-description"
        className="w-full bg-gray-200 rounded-full h-2"
      >
        <div
          className="bg-blue-600 h-2 rounded-full transition-all duration-300"
          style={{ width: `${percentage}%` }}
        />
      </div>
      <div id="progress-description" className="sr-only">
        {label} progress: {value} out of {max} completed
      </div>
    </div>
  );
};
```

### 5. Error Boundary and Error Handling

#### 5.1 Error Boundary Implementation
```typescript
interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
}

class ErrorBoundary extends Component<
  React.PropsWithChildren<{}>,
  ErrorBoundaryState
> {
  constructor(props: React.PropsWithChildren<{}>) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ error, errorInfo });
    
    // Log error to monitoring service
    logger.error('React Error Boundary caught an error:', {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="max-w-md w-full bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center mb-4">
              <AlertTriangle className="h-8 w-8 text-red-500 mr-3" />
              <h2 className="text-xl font-semibold text-gray-900">
                Something went wrong
              </h2>
            </div>
            <p className="text-gray-600 mb-6">
              We're sorry, but something unexpected happened. Please try refreshing the page.
            </p>
            <div className="flex space-x-3">
              <Button
                onClick={() => window.location.reload()}
                className="flex-1"
              >
                Refresh Page
              </Button>
              <Button
                variant="outline"
                onClick={() => window.history.back()}
                className="flex-1"
              >
                Go Back
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
```

#### 5.2 API Error Handling
```typescript
const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  timeout: 10000,
});

// Request interceptor
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('authToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      
      try {
        const refreshToken = localStorage.getItem('refreshToken');
        const response = await apiClient.post('/auth/refresh', {
          refreshToken,
        });
        
        const { accessToken } = response.data;
        localStorage.setItem('authToken', accessToken);
        
        return apiClient(originalRequest);
      } catch (refreshError) {
        // Redirect to login
        window.location.href = '/login';
        return Promise.reject(refreshError);
      }
    }
    
    return Promise.reject(error);
  }
);
```

### 6. Testing Specifications

#### 6.1 Component Testing
```typescript
describe('CourseCard', () => {
  it('renders course information correctly', () => {
    const mockCourse = {
      id: '1',
      title: 'React Fundamentals',
      description: 'Learn React basics',
      duration: '4 hours',
      enrollmentCount: 1250,
    };

    render(<CourseCard course={mockCourse} />);
    
    expect(screen.getByText('React Fundamentals')).toBeInTheDocument();
    expect(screen.getByText('Learn React basics')).toBeInTheDocument();
    expect(screen.getByText('4 hours')).toBeInTheDocument();
    expect(screen.getByText('1250')).toBeInTheDocument();
  });

  it('shows progress when provided', () => {
    const mockCourse = { /* course data */ };
    const mockProgress = {
      completionPercentage: 75,
      completed: false,
    };

    render(<CourseCard course={mockCourse} progress={mockProgress} />);
    
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '75');
  });

  it('handles click events', () => {
    const mockCourse = { /* course data */ };
    const mockOnClick = jest.fn();

    render(<CourseCard course={mockCourse} onClick={mockOnClick} />);
    
    fireEvent.click(screen.getByRole('button'));
    expect(mockOnClick).toHaveBeenCalledTimes(1);
  });

  it('is accessible with keyboard navigation', () => {
    const mockCourse = { /* course data */ };
    const mockOnClick = jest.fn();

    render(<CourseCard course={mockCourse} onClick={mockOnClick} />);
    
    const card = screen.getByRole('button');
    card.focus();
    
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(mockOnClick).toHaveBeenCalledTimes(1);
  });
});
```

#### 6.2 Integration Testing
```typescript
describe('Course Learning Flow', () => {
  it('allows user to complete a lesson and track progress', async () => {
    const user = userEvent.setup();
    
    render(<CourseView courseId="1" />);
    
    // Wait for course to load
    await waitFor(() => {
      expect(screen.getByText('React Fundamentals')).toBeInTheDocument();
    });
    
    // Start first lesson
    await user.click(screen.getByText('Start Lesson'));
    
    // Complete video
    const video = screen.getByTestId('lesson-video');
    fireEvent.ended(video);
    
    // Mark lesson as complete
    await user.click(screen.getByText('Mark Complete'));
    
    // Verify progress update
    await waitFor(() => {
      expect(screen.getByText('25%')).toBeInTheDocument();
    });
  });
});
```

---

*These technical specifications provide the detailed implementation guidance needed to build a robust, performant, and accessible frontend for the learning platform.*