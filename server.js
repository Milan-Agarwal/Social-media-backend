// Backend: server.js (Express + MongoDB + JWT Auth)
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const { Server } = require('socket.io');
const http = require('http');

dotenv.config();
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.use(express.json());
app.use(cors({ origin: '*' }));
app.use('/uploads', express.static('uploads'));

mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log("MongoDB Connected"))
  .catch(err => console.log(err));

  const UserSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    email: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    profilePicture: { type: String, default: "" },
    friends: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    
}, { timestamps: true });




const PostSchema = new mongoose.Schema({
    userId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true 
    },
    content: { 
        type: String, 
        required: true, 
        trim: true 
    },
    image: { 
        type: String,
        default: ""
    },
    likes: [{ 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User' 
    }],
    comments: [{
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        text: { type: String, required: true }
    }],
    privacy: { 
        type: String, 
        enum: ['Public', 'Friends', 'Private'], 
        default: 'Public' 
    }
}, { timestamps: true });


const User = mongoose.model('User', UserSchema);
const Post = mongoose.model('Post', PostSchema);

// Signup Route
app.post('/signup', async (req, res, next) => {
    const { username, email, password } = req.body;

    try {
        const existingEmail = await User.findOne({ email });
        if (existingEmail) {
            return res.status(400).json({ error: "Email already registered" });
        }

        const existingUsername = await User.findOne({ username });
        if (existingUsername) {
            return res.status(400).json({ error: "Username already taken" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ username, email, password: hashedPassword });

        await newUser.save();
        res.status(201).json({ message: "User registered successfully" });
    } catch (error) {
        next(error); // Pass error to middleware
    }
});



// Login Route
app.post('/login', async (req, res, next) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ error: 'User not found' }); // Invalid email
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ error: 'Invalid credentials' }); // Password is incorrect
        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
        res.json({ token, user });
    } catch (error) {
        next(error);
    }
});

// Create Post
app.post('/posts', async (req, res, next) => {
    try {
        const { userId, content, image, privacy } = req.body;
        
        const newPost = new Post({ userId, content, image, privacy });
        await newPost.save();

        // Populate the `userId` to include username
        const populatedPost = await Post.findById(newPost._id).populate("userId", "username profilePicture");

        res.status(201).json(populatedPost);
    } catch (err) {
        next(err);
    }
});


app.get('/posts', async (req, res, next) => {
    try {
        const posts = await Post.find().populate('userId', 'username'); // Populate user details
        res.json(posts);
    } catch (error) {
        next(error);
    }
});
// Like Post
app.post('/post/like', async (req, res, next) => {
    const { userId, postId } = req.body;
    try {
        let post = await Post.findById(postId);
        if (!post.likes.includes(userId)) {
            post.likes.push(userId);
            await post.save();
        }
        else{
            post = await Post.findByIdAndUpdate(
                postId,
                { $pull: { likes: userId } }, // Remove userId from likes array
                { new: true } // Return the updated document
            );
            await post.save();
        }
        res.json(post);
    } catch (error) {
        next(error);
    }
});
// Delete Post API
app.delete("/posts/:postId", async (req, res, next) => {
    try {
        const { postId } = req.params;
        const { userId } = req.body; // Logged-in user ID

        const post = await Post.findById(postId);
        if (!post) {
            return res.status(404).json({ error: "Post not found" });
        }

        // Check if the logged-in user is the owner of the post
        if (post.userId.toString() !== userId) {
            return res.status(403).json({ error: "You can only delete your own posts" });
        }

        await Post.findByIdAndDelete(postId);
        res.json({ message: "Post deleted successfully", postId });
    } catch (err) {
        next(err);
    }
});
// Get all users except the logged-in user
app.get("/users", async (req, res, next) => {
    const { userId } = req.query; // Pass the logged-in user's ID as a query parameter
    try {
        const users = await User.find({ _id: { $ne: userId } }, "_id username profilePicture");
        res.json(users);
    } catch (err) {
        next(err);
    }
});

// Add Friend API
app.post("/add-friend", async (req, res, next) => {
    const { userId, friendId } = req.body;
    try {
        const user = await User.findById(userId);
        if (!user.friends.includes(friendId)) {
            user.friends.push(friendId);
            await user.save();
        }
        res.json({ success: true, message: "Friend Added" });
    } catch (err) {
        next(err);
    }
});
// Get list of friends for a user
app.get("/user/:userId/friends", async (req, res, next) => {
    try {
        const user = await User.findById(req.params.userId).populate("friends", "username profilePicture");
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }
        res.json(user.friends); // Return list of friends
    } catch (err) {
        next(err);
    }
});





app.put('/users/:id/profile-picture', async (req, res, next) => {
    try {
        const { id } = req.params;
        const { profilePicture } = req.body;

        const user = await User.findByIdAndUpdate(
            id,
            { profilePicture },
            { new: true }
        );

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        res.json({ success: true, message: "Profile picture updated successfully", user });
    } catch (error) {
        next(error);
    }
});

// Fetch user profile
app.get('/user/:id', async (req, res, next) => {
    try {
        const user = await User.findById(req.params.id).select('-password');
        res.json(user);
    } catch (error) {
        next(error);
    }
});

// Error Handling Middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: "Internal Server Error" });
});

// Graceful Shutdown
const shutdown = async () => {
    console.log("Shutting down server...");
    try {
        await mongoose.connection.close();
        console.log("MongoDB connection closed.");
        server.close(() => {
            console.log("HTTP server closed.");
            process.exit(0);
        });
    } catch (err) {
        console.error("Error during shutdown:", err);
        process.exit(1);
    }
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));