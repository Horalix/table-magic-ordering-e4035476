import { Navigate } from 'react-router-dom';

// [FIX] Redirect root to menu instead of showing placeholder
const Index = () => <Navigate to="/menu" replace />;

export default Index;
